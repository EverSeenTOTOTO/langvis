import { getPrefetchPath, serverFetch } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import { isClient } from '@/shared/utils';
import { createAuthClient } from 'better-auth/react';
import { inject } from 'tsyringe';
import { UserStore } from './user';

type SignUpParams = Parameters<
  ReturnType<typeof createAuthClient>['signUp']['email']
>[0];
type SignInParams = Parameters<
  ReturnType<typeof createAuthClient>['signIn']['email']
>[0];
type SignOutParams = Parameters<
  ReturnType<typeof createAuthClient>['signOut']
>[0];
type GetSessionParams = Parameters<
  ReturnType<typeof createAuthClient>['getSession']
>[0];

@store()
export class AuthStore {
  // In the browser the default client uses same-origin fetch + browser cookies.
  // In the CLI (bun, no cookie jar) route through the shared fetch-cookie jar
  // (serverFetch) so the session cookie is shared with the API + SSE layers,
  // and point at the backend origin.
  private client = createAuthClient(
    isClient()
      ? {}
      : {
          baseURL: getPrefetchPath(''),
          fetchOptions: {
            customFetchImpl: (async (
              input: string | URL | Request,
              init?: RequestInit,
            ) => {
              const fetchFn = await serverFetch.init();
              return fetchFn(input, init);
            }) as typeof fetch,
          },
        },
  );

  constructor(@inject(UserStore) private user?: UserStore) {}

  async signUpEmail(params: SignUpParams) {
    const result = await this.client.signUp.email(params);
    if (result.data?.user && this.user) {
      this.user.currentUser = result.data.user;
    }
    return result;
  }

  async signInEmail(params: SignInParams) {
    const result = await this.client.signIn.email(params);
    if (result.data?.user && this.user) {
      this.user.currentUser = result.data.user;
    }
    return result;
  }

  async signOut(params: SignOutParams) {
    const result = await this.client.signOut(params);
    if (this.user) {
      this.user.currentUser = null;
    }
    return result;
  }

  async getSession(param: GetSessionParams = {}) {
    const result = await this.client.getSession(param);
    if (this.user) {
      this.user.currentUser = result.data?.user ?? null;
    }
    return result;
  }
}
