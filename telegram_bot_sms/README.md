# 🤖 Telegram Bot SMS

A lightweight and secure **Telegram bot for phone number verification and authentication integration**, built with **Python** and **aiogram 3**.

The bot allows users to share their phone number directly through Telegram and securely sends the phone number together with the user's Telegram `chat_id` to an internal authentication service.

This project is designed as a **Telegram integration layer** rather than a standalone authentication system. Business logic such as OTP generation, verification, and user management can be handled by the connected backend service.

---

## ✨ Features

- 📱 **Phone Number Sharing** — Uses Telegram's native contact-sharing functionality.
- 🇺🇿 **Uzbekistan Phone Number Support** — Normalizes phone numbers to the `+998XXXXXXXXX` format.
- 🔐 **Secure Internal API Communication** — Communicates with the backend using an internal service token.
- 🤖 **Telegram Bot Integration** — Built with `aiogram 3`.
- ⚡ **Asynchronous Architecture** — Uses Python's `asyncio` and aiogram's asynchronous polling.
- 🧩 **Backend Integration** — Sends the user's phone number and Telegram `chat_id` to an internal service.
- 📝 **Error Logging** — Logs failed internal service requests without exposing internal errors to users.
- ⚙️ **Environment-Based Configuration** — Sensitive credentials are loaded from environment variables.

---

## 🏗️ Architecture

```text
                    ┌─────────────────┐
                    │   Telegram User │
                    └────────┬────────┘
                             │
                             │ /start
                             ▼
                  ┌──────────────────────┐
                  │    Telegram Bot      │
                  │                      │
                  │      aiogram 3       │
                  └──────────┬───────────┘
                             │
                             │ Share Phone Number
                             ▼
                  ┌──────────────────────┐
                  │  Phone Normalization │
                  │                      │
                  │   +998XXXXXXXXX      │
                  └──────────┬───────────┘
                             │
                             │ HTTP POST
                             │
                             ▼
              ┌──────────────────────────────┐
              │    Internal Auth Service     │
              │                              │
              │  phone_number                │
              │  chat_id                     │
              └──────────────────────────────┘
```

---

## 🔄 How It Works

### 1. Start the Bot

The user sends:

```text
/start
```

The bot responds with a Telegram keyboard containing a button for sharing the user's phone number.

### 2. Share Phone Number

The user presses:

```text
📱 Telefon raqamni ulashish
```

Telegram sends the user's contact information to the bot.

### 3. Normalize Phone Number

The bot converts the phone number into a consistent Uzbekistan format:

```text
+998XXXXXXXXX
```

Common formatting characters such as spaces, hyphens, and parentheses are removed.

### 4. Send Data to Internal Service

The bot sends the following information to the internal backend:

```json
{
  "phone_number": "+998901234567",
  "chat_id": "123456789"
}
```

The request is authenticated using an internal service token.

### 5. User Confirmation

If the backend successfully processes the request, the user receives a confirmation message and can continue the authentication process.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| 🐍 Python 3.14+ | Application runtime |
| 🤖 aiogram 3.30+ | Telegram Bot framework |
| 🌐 Requests | Internal HTTP communication |
| ⚡ asyncio | Asynchronous execution |
| 🔐 Environment Variables | Secret management |
| 📦 uv | Dependency management |

Project dependencies are defined in `pyproject.toml`. 

---

## 📂 Project Structure

```text
telegram_bot_sms/
│
├── main.py
├── pyproject.toml
├── uv.lock
├── .gitignore
└── README.md
```

### `main.py`

The main application contains:

- Telegram bot initialization
- `/start` command handler
- Contact message handler
- Phone number normalization
- Internal API communication
- Authentication headers
- Error handling
- Logging
- Telegram polling

The bot reads its configuration from environment variables. 

---

## ⚙️ Environment Variables

The application requires three environment variables:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ILBI_INTERNAL_URL=https://your-internal-service.example/api/...
INTERNAL_SERVICE_TOKEN=your_internal_service_token
```

### Environment Variables Reference

| Variable | Description | Required |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | ✅ |
| `ILBI_INTERNAL_URL` | Internal authentication service endpoint | ✅ |
| `INTERNAL_SERVICE_TOKEN` | Token used to authenticate internal API requests | ✅ |

> ⚠️ **Never commit real tokens, passwords, or secrets to Git.**

Use environment variables or a dedicated secret-management system in production.

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Abdulxadiy/telegram_bot_sms.git
```

```bash
cd telegram_bot_sms
```

### 2. Create a Virtual Environment

#### Linux / macOS

```bash
python -m venv .venv
source .venv/bin/activate
```

#### Windows

```powershell
python -m venv .venv
.venv\Scripts\activate
```

### 3. Install Dependencies

Using `pip`:

```bash
pip install -e .
```

Or using `uv`:

```bash
uv sync
```

The project currently requires **Python 3.14+**, `aiogram>=3.30.0`, and `requests>=2.34.2`. 

---

## ▶️ Running the Bot

Configure your environment variables first.

Then start the bot:

```bash
python main.py
```

Or with `uv`:

```bash
uv run python main.py
```

The application starts Telegram long polling and waits for incoming messages. 

---

## 🔌 Internal API

The bot communicates with the internal authentication service using an HTTP `POST` request.

### Request

```http
POST <ILBI_INTERNAL_URL>
Authorization: Internal <INTERNAL_SERVICE_TOKEN>
Content-Type: application/json
```

### Request Body

```json
{
  "phone_number": "+998901234567",
  "chat_id": "123456789"
}
```

### Example

```text
Telegram
   │
   │ phone_number + chat_id
   ▼
Telegram Bot
   │
   │ POST /internal/...
   │ Authorization: Internal <token>
   ▼
Authentication Service
```

The current implementation uses a **5-second request timeout** and handles `requests.RequestException` errors. 

---

## 🔐 Security

Because this service is involved in authentication-related workflows, security should be treated as a primary concern.

Contact linking accepts only the sender's own contact in a private chat. The backend also rejects group/channel IDs for 2FA registration and OTP delivery. Existing group-linked contacts must reconnect in the bot's private chat. Store report delivery to Telegram groups is separate and remains supported.

### Recommended Practices

- 🔒 Never hard-code secrets in source code.
- 🔑 Store `TELEGRAM_BOT_TOKEN` and `INTERNAL_SERVICE_TOKEN` in environment variables.
- 🌐 Use HTTPS for remote internal services.
- 🛡️ Authenticate all internal API requests.
- 🚦 Implement rate limiting on the backend.
- 📝 Avoid logging sensitive information.
- 🔄 Rotate compromised tokens immediately.
- ✅ Validate phone numbers on the backend as well.
- 🔐 Keep authentication business logic inside the trusted backend service.

---

## ⚠️ Error Handling

If the internal service is unavailable or returns an unsuccessful response, the bot sends a generic error message to the user:

```text
❌ An error occurred. Please try again later.
```

The technical exception is logged internally instead of being exposed to the user.

This approach helps prevent internal implementation details from leaking through Telegram responses. 

---

## 📈 Production Recommendations

For production environments, the following improvements are recommended:

- 🐳 Docker containerization
- 🔄 CI/CD pipeline
- 📊 Application monitoring
- 📝 Structured logging
- ❤️ Health checks
- 🚦 Rate limiting
- 🔁 Retry mechanism with exponential backoff
- 🔐 Dedicated secret management
- 📡 Centralized logs
- 🧪 Automated testing

---

## ⚡ Backend request handling

Contact registration runs `requests.post` through `await asyncio.to_thread(...)`. Waiting for the backend leaves the event loop available for other commands and contacts. The existing five-second Requests timeout, internal authorization, private-chat checks and per-chat flood guard are preserved.

The worker uses the existing Requests dependency and the standard asyncio thread pool. A cancelled handler does not stop an HTTP call that is already running in a worker.

---

## Tests

From the repository root, using the bot's Python environment:

```bash
telegram_bot_sms/.venv/bin/python -m unittest discover -s telegram_bot_sms/tests -p "test_contact_handler.py" -v
```

The 13 tests use synthetic messages, credentials and mocked requests; they never contact Telegram or the backend. They cover private-chat checks, progress of another command/contact during a slow request, duplicate-contact throttling and connection/HTTP failures. Backend registration, legacy contact and OTP tests are documented in `backend/README_TESTS.md`.

## 🧪 Future Improvements

- [x] Add private-chat contact-handler unit tests (mocked outbound HTTP)
- [ ] Add integration tests
- [ ] Replace `requests` with an async HTTP client
- [ ] Add structured logging
- [ ] Add rate limiting
- [ ] Add retry and backoff mechanisms
- [ ] Add Docker support
- [ ] Add GitHub Actions CI/CD
- [ ] Add monitoring and health checks
- [ ] Improve phone-number validation
- [ ] Add comprehensive API error handling
- [ ] Add production configuration management

---

## 🎯 Purpose

This project demonstrates how a Telegram bot can be integrated into a modern authentication architecture.

Instead of making the Telegram bot responsible for the entire authentication process, it acts as a lightweight **communication bridge** between:

```text
Telegram
    ↓
Telegram Bot
    ↓
Internal Authentication Service
    ↓
OTP / Authentication Workflow
```

This separation keeps the bot simple while allowing the main backend to control authentication, user management, OTP generation, and verification.

---

## 👨‍💻 Author

**Abdulxadiy**

Backend Developer | Python | Django | Telegram Bots

GitHub:

https://github.com/Abdulxadiy

---

## 📄 License

No open-source license has been specified for this repository yet.

If this project is intended for public reuse, consider adding an appropriate license such as:

```text
MIT License
```

---

## ⭐ Support

If you find this project useful, consider giving it a ⭐ on GitHub.

---

**Built with 🐍 Python and 🤖 aiogram**
