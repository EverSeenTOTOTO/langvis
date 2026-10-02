import { Inject, Injectable } from '@nestjs/common';
import type { Express } from 'express';
import { AuthService } from '@/server/modules/user/infrastructure/auth.service';
import { mountSsr } from './ssr';
import { ssrRequestContext } from './requestId';

// SSR 挂载单元：post-init 在 /api 路由之后注册（must be last）。
// SSR 路由不经 Nest middleware，请求上下文在此单独套用。
@Injectable()
export class SsrMountService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async mount(app: Express): Promise<void> {
    app.use(ssrRequestContext(this.authService));
    await mountSsr(app, this.authService);
  }
}
