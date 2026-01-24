import { AgentIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig<{
  tts?: {
    voice?: string;
    emotion?: 'happy' | 'hate' | 'sad';
    speedRatio?: number;
  };
}> = {
  extends: AgentIds.CHAT,
  name: 'GirlFriend Agent',
  description:
    'A conversational agent that engages in natural dialogue with users, maintaining conversation history and context for coherent responses.',
  configSchema: {
    type: 'object',
    properties: {
      tts: {
        type: 'object',
        properties: {
          voice: {
            type: 'string',
            enum: [
              'zh_female_roumeinvyou_emo_v2_mars_bigtts',
              'zh_female_meilinvyou_emo_v2_mars_bigtts',
              'zh_female_gaolengyujie_emo_v2_mars_bigtts',
              'zh_female_qingxinnvsheng_mars_bigtts',
              'zh_female_zhixingnvsheng_mars_bigtts',
              'zh_female_linjianvhai_moon_bigtts',
              'ICL_zh_female_zhixingwenwan_tob',
              'ICL_zh_female_wenrouwenya_tob',
              'ICL_zh_female_wenyinvsheng_v1_tob',
              'ICL_zh_female_feicui_v1_tob',
              'ICL_zh_female_yuxin_v1_tob',
              'ICL_zh_female_yry_tob',
              'zh_female_gaolengyujie_moon_bigtts',
              'zh_female_sajiaonvyou_moon_bigtts',
              'ICL_zh_female_huopodiaoman_tob',
              'ICL_zh_female_aomanjiaosheng_tob',
              'ICL_zh_female_nuanxinxuejie_tob',
              'ICL_zh_female_chengshujiejie_tob',
              'ICL_zh_female_wumeiyujie_tob',
              'ICL_zh_female_aojiaonvyou_tob',
              'ICL_zh_female_ganli_v1_tob',
              'ICL_zh_female_xiangliangya_v1_tob',
              'ICL_zh_female_xingganyujie_tob',
              'ICL_zh_female_luoqing_v1_tob',
              'ICL_zh_female_jiaxiaozi_tob',
            ],
            nullable: true,
          },
          emotion: {
            type: 'string',
            enum: ['happy', 'hate', 'sad'],
            default: 'hate',
            nullable: true,
          },
          speedRatio: {
            type: 'number',
            default: 1.2,
            minimum: 0.5,
            maximum: 2.0,
            nullable: true,
          },
        },
        nullable: true,
      },
    },
  },
};
