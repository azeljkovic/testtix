import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, RegisterRequestSchema } from '@testtix/shared';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useSearchParams } from 'react-router';

import { authPagePath, safeRedirectPath } from '../auth/redirect.js';
import { useRegister, useSession } from '../auth/session.js';
import { FormAlert } from '../forms/FormAlert.js';
import { showSubmitError } from '../forms/form-errors.js';
import { SubmitButton } from '../forms/SubmitButton.js';
import { TextField } from '../forms/TextField.js';
import { PageTitle } from '../layout/PageTitle.js';

export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get('redirectTo');
  const session = useSession();
  const register = useRegister();
  const { control, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(RegisterRequestSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  // New accounts land on the account page, which asks them to verify their email address.
  if (session.data) {
    return <Navigate to={safeRedirectPath(redirectParam, '/account')} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      await register.mutateAsync(values);
    } catch (error) {
      showSubmitError(error, setError, ['name', 'email', 'password']);
    }
  });

  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Create an account" />
      <h1 className="text-3xl font-bold tracking-tight">Create an account</h1>
      <form
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="mt-8 flex flex-col gap-5"
      >
        {formState.errors.root?.server && (
          <FormAlert>{formState.errors.root.server.message}</FormAlert>
        )}
        <TextField control={control} name="name" label="Name" autoComplete="name" />
        <TextField control={control} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          control={control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <SubmitButton isPending={formState.isSubmitting}>Create account</SubmitButton>
      </form>
      <p className="mt-6 text-slate-600">
        Already have an account?{' '}
        <Link
          to={authPagePath('/login', redirectParam ?? '/')}
          className="font-medium text-indigo-700 underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
