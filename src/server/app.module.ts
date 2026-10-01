import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { InfraModule } from './infra.module';
import { UserModule } from './modules/user/user.module';
import { SettingsModule } from './modules/settings/settings.module';
import { DocumentModule } from './modules/document/document.module';
import { EmailModule } from './modules/email/email.module';
import { FileModule } from './modules/file/file.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { AgentModule } from './modules/agent/agent.module';

// Nest 根模块。InfraModule 排首位：其 providers 先 init、最后 destroy（DB 池最后关）。
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    InfraModule,
    CqrsModule.forRoot(),
    UserModule,
    SettingsModule,
    DocumentModule,
    EmailModule,
    FileModule,
    ConversationModule,
    AgentModule,
  ],
})
export class AppModule {}
