import { useAuth } from './store/auth';
import { useTheme } from './hooks/useTheme';
import { AuthScreen } from './screens/AuthScreen';
import { ChatScreen } from './screens/ChatScreen';

export function App() {
  useTheme(); // hydrate Light/Dark/System from storage before first paint
  const accessToken = useAuth((s) => s.accessToken);
  return accessToken ? <ChatScreen /> : <AuthScreen />;
}
