import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import {
  type AuthSession,
  fetchSession,
  login,
  logout,
  register,
  resendVerificationEmail,
} from '../api/auth.js';

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

/** The session query shared across the app: `null` when nobody is logged in. */
export const sessionQuery = queryOptions({
  queryKey: SESSION_QUERY_KEY,
  queryFn: ({ signal }) => fetchSession(signal),
});

/** The current session. `data` is `null` when logged out and `undefined` while loading. */
export function useSession() {
  return useQuery(sessionQuery);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (session) =>
      queryClient.setQueryData<AuthSession | null>(SESSION_QUERY_KEY, session),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: (session) =>
      queryClient.setQueryData<AuthSession | null>(SESSION_QUERY_KEY, session),
  });
}

/** Ends the session and goes to the home page. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      // Leave first: clearing the session while a guarded page is still on screen would redirect to
      // the login page. React Router renders navigations as transitions, so `navigate` can resolve
      // before the new page is on screen; `flushSync` commits it before the session is cleared.
      await navigate('/', { flushSync: true });
      queryClient.setQueryData<AuthSession | null>(SESSION_QUERY_KEY, null);
    },
  });
}

export function useResendVerificationEmail() {
  return useMutation({ mutationFn: resendVerificationEmail });
}

/** Re-reads the session, e.g. after the email address was verified. */
export function useRefreshSession() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}
