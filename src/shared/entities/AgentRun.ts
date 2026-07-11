import type { AgentRun as AgentRunType } from '@/shared/types/entities';
import type { RunStatus } from '@/shared/types/agent';
import type { EnrichedEvent } from '@/shared/types/events';
import type { RunConfigVOProps } from '@/server/modules/agent/domain/model/run-config.vo';
import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { generateId } from '@/shared/utils';

export { RunStatus };

@Entity('agent_runs')
export class AgentRunEntity implements AgentRunType {
  @PrimaryColumn('varchar', { length: 16 })
  id!: string;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) {
      this.id = generateId('run');
    }
  }

  @Column({ type: 'varchar', length: 32 })
  status!: RunStatus;

  /** 事实源 —— 投影 (content/steps) 由 projectRun 派生，不持久化投影结果 */
  @Column({ type: 'jsonb', nullable: true })
  events!: EnrichedEvent[] | null;

  @Column({ type: 'jsonb', nullable: true })
  config!: RunConfigVOProps | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  startedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  /** loop 退出折叠的过程摘要；挂 msg.summary 透传至 agent 种子作 thought。 */
  @Column({ type: 'text', nullable: true })
  processSummary!: string | null;
}
