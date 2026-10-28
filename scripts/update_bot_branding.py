"""Apply the reviewed ILBI bot profile without sending chat messages.

Telegram reference: https://core.telegram.org/bots/api#setmyprofilephoto
Uses local credentials without printing them. Repeated matching updates are skipped.
"""
import argparse
import hashlib
import json
from pathlib import Path

import requests
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply the reviewed public profile.')
    args = parser.parse_args()
    plan = json.loads((ROOT / 'branding/ilbi-bot-profile.json').read_text())
    backend = dotenv_values(ROOT / 'backend/.env')
    bot = dotenv_values(ROOT / 'telegram_bot_sms/.env')
    token = backend.get('TELEGRAM_BOT_TOKEN')
    if not token or token != bot.get('TELEGRAM_BOT_TOKEN'):
        raise RuntimeError('Backend and bot credentials must identify the same configured bot.')

    def call(method, data=None, files=None):
        try:
            response = requests.post(
                f'https://api.telegram.org/bot{token}/{method}', data=data, files=files, timeout=30,
            )
            payload = response.json()
        except (requests.RequestException, ValueError):
            raise RuntimeError(f'Telegram {method}: connection or response error; credential omitted.') from None
        if not response.ok or not payload.get('ok'):
            raise RuntimeError(f'Telegram {method} rejected the request (HTTP {response.status_code}).')
        return payload['result']

    identity = call('getMe')
    if identity.get('username') != plan['username']:
        raise RuntimeError('Configured bot differs from the reviewed ILBI username; nothing changed.')
    changed = []
    before = {'username': identity['username'], 'languages': {}}
    checks = []
    for language, desired in plan['languages'].items():
        parameters = {'language_code': language}
        current = {
            'name': call('getMyName', parameters)['name'],
            'description': call('getMyDescription', parameters)['description'],
            'short_description': call('getMyShortDescription', parameters)['short_description'],
            'commands': call('getMyCommands', parameters),
        }
        before['languages'][language] = current
        for field, setter in [('name', 'setMyName'), ('description', 'setMyDescription'),
                              ('short_description', 'setMyShortDescription'), ('commands', 'setMyCommands')]:
            value = plan['name'] if field == 'name' else desired[field]
            matches = current[field] == value
            if not matches and args.apply:
                data = {**parameters, field: json.dumps(value, ensure_ascii=False) if field == 'commands' else value}
                call(setter, data)
                changed.append(setter + ':' + (language or 'default'))
                matches = True
            checks.append(matches)
    if args.apply:
        backup = Path('/tmp/ilbi-bot-profile-before.json')
        if not backup.exists():
            backup.write_text(json.dumps(before, ensure_ascii=False, indent=2) + '\n')
            backup.chmod(0o600)
        image = ROOT / plan['avatar']
        digest = hashlib.sha256(image.read_bytes()).hexdigest()
        state_path = ROOT / 'branding/ilbi-bot-profile-state.json'
        previous = json.loads(state_path.read_text()) if state_path.exists() else {}
        if previous.get('avatar_sha256') != digest or previous.get('bot_id') != identity['id']:
            with image.open('rb') as file:
                call('setMyProfilePhoto', {'photo': json.dumps({'type': 'static', 'photo': 'attach://avatar'})},
                     {'avatar': (image.name, file, 'image/jpeg')})
            changed.append('setMyProfilePhoto')
        state_path.write_text(json.dumps({
            'username': plan['username'], 'bot_id': identity['id'], 'name': plan['name'],
            'avatar_sha256': digest, 'profile_applied': all(checks),
            'languages': list(plan['languages']), 'chat_messages_sent': 0,
        }, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'username': identity['username'], 'profile_matches': all(checks),
                      'applied_methods': changed, 'chat_messages_sent': 0}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
