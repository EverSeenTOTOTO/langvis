import { singleton } from 'tsyringe';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({});

@singleton()
export class AuthStore {
  private client = createAuthClient({});

  get signUp() {
    return this.client.signUp;
  }

  get signIn() {
    return this.client.signIn;
  }

  get signOut() {
    return this.client.signOut;
  }

  get getSession() {
    return this.client.getSession;
  }
}
