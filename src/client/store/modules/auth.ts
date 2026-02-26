import { store } from '@/client/decorator/store';
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
  private client = createAuthClient({});

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
