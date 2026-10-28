import { Redirect } from 'expo-router';
import { useAuth } from '../features/auth/AuthContext';
import { sessionEntry } from '../features/auth/routePolicy';
export default function Entry() {
  const { user, activeTenant } = useAuth();
  return <Redirect href={sessionEntry(user, activeTenant)} />;
}
