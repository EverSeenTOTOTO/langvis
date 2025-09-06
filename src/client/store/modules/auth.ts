import { createAuthClient } from 'better-auth/react';
import { inject, singleton } from 'tsyringe';
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

@singleton()
export class AuthStore {
  private client = createAuthClient({});

  constructor(@inject(UserStore) private user?: UserStore) {}

  async signUpAndSetUser(params: SignUpParams) {
    const result = await this.client.signUp.email(params);
    if (result.data?.user) {
      this.user?.setCurrentUser(result.data.user);
    }
    return result;
  }

  async signInAndSetUser(params: SignInParams) {
    const result = await this.client.signIn.email(params);
    if (result.data?.user) {
      this.user?.setCurrentUser(result.data.user);
    }
    return result;
  }

  async signOutAndClearUser(params: SignOutParams) {
    const result = await this.client.signOut(params);
    this.user?.setCurrentUser(null);
    return result;
  }

  async getSession(param: GetSessionParams = {}) {
    const result = await this.client.getSession(param);
    if (result.data?.user) {
      this.user?.setCurrentUser(result.data.user);
    } else {
      this.user?.setCurrentUser(null);
    }
    return result;
  }
}

