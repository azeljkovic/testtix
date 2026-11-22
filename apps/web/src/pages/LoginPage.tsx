import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema } from '@testtix/shared';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useSearchParams } from 'react-router';

import { authPagePath, safeRedirectPath } from '../auth/redirect.js';
import { useLogin, useSession } from '../auth/session.js';
import { FormAlert } from '../forms/FormAlert.js';
import { showSubmitError } from '../forms/form-errors.js';
import { SubmitButton } from '../forms/SubmitButton.js';
import { TextField } from '../forms/TextField.js';
import { PageTitle } from '../layout/PageTitle.js';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get('redirectTo');
  const session = useSession();
  const login = useLogin();
  const { control, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  // Covers both a visitor who is already logged in and a successful login.
  if (session.data) {
    return <Navigate to={safeRedirectPath(redirectParam, '/')} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch (error) {
      showSubmitError(error, setError, ['email', 'password'], {
        INVALID_CREDENTIALS: 'The email address or password is incorrect.',
      });
    }
  });

  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Log in" />
      <h1 className="text-3xl font-bold tracking-tight">Log in</h1>
      <form
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="mt-8 flex flex-col gap-5"
      >
        {formState.errors.root?.server && (
          <FormAlert>{formState.errors.root.server.message}</FormAlert>
        )}
        <TextField control={control} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          control={control}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <SubmitButton isPending={formState.isSubmitting}>Log in</SubmitButton>
      </form>
      <p className="mt-6 text-slate-600">
        New to TestTix?{' '}
        <Link
          to={authPagePath('/register', redirectParam ?? '/')}
          className="font-medium text-indigo-700 underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
