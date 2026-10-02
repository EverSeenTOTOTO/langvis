import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';
import { AuthService } from './infrastructure/auth.service';
import { Public } from '@/server/guards/auth.guard';

// better-auth HTTP 处理器透传：raw req/res 直通（Nest root 化后收编进 /api，
// 免登录访问——鉴权由 better-auth 自己管，不走全局 AuthGuard）。
@Public()
@Controller('auth')
export class AuthProxyController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @All('*path')
  proxy(@Req() req: Request, @Res() res: Response): void {
    toNodeHandler(this.authService.handler)(req, res);
  }
}
