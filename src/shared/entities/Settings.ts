import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { UserEntity } from './User';

export type ThemeMode = 'light' | 'dark';

export interface Settings {
  userId: string;
  themeMode: ThemeMode;
  locale: string;
}

@Entity('settings')
export class SettingsEntity implements Settings {
  @PrimaryColumn('uuid')
  userId!: string;

  @Column({ type: 'varchar', length: 16, default: 'dark' })
  themeMode!: ThemeMode;

  @Column({ type: 'varchar', length: 16, default: 'en_US' })
  locale!: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: typeof UserEntity;
}
