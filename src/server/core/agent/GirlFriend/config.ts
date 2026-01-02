import { AgentIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  extends: AgentIds.CHAT,
  name: {
    en: 'GirlFriend Agent',
    zh: '缓解性压抑智能体',
  },
  description: {
    en: 'A conversational agent that engages in natural dialogue with users, maintaining conversation history and context for coherent responses.',
    zh: '与用户进行自然对话的会话智能体，维护对话历史和上下文以提供连贯的回应。',
  },
  config: {
    tts: {
      type: 'group',
      label: {
        en: 'Text-to-Speech Settings',
        zh: '文本转语音设置',
      },
      children: {
        voice: {
          type: 'select',
          label: {
            en: 'Voice Type',
            zh: '音色',
          },
          required: true,
          span: 8,
          options: [
            {
              label: '温柔女友（v2）',
              value: 'zh_female_roumeinvyou_emo_v2_mars_bigtts',
            },
            {
              label: '魅力女友（v2）',
              value: 'zh_female_meilinvyou_emo_v2_mars_bigtts',
            },
            {
              label: '高冷御姐（v2）',
              value: 'zh_female_gaolengyujie_emo_v2_mars_bigtts',
            },
            {
              label: '清新女声',
              value: 'zh_female_qingxinnvsheng_mars_bigtts',
            },
            {
              label: '知性女声',
              value: 'zh_female_zhixingnvsheng_mars_bigtts',
            },
            {
              label: '邻家女孩',
              value: 'zh_female_linjianvhai_moon_bigtts',
            },
            {
              label: '知性温婉',
              value: 'ICL_zh_female_zhixingwenwan_tob',
            },
            {
              label: '温柔文雅',
              value: 'ICL_zh_female_wenrouwenya_tob',
            },
            {
              label: '文艺女声',
              value: 'ICL_zh_female_wenyinvsheng_v1_tob',
            },
            {
              label: '纯澈女声',
              value: 'ICL_zh_female_feicui_v1_tob',
            },
            {
              label: '初恋女友',
              value: 'ICL_zh_female_yuxin_v1_tob',
            },
            {
              label: '温柔白月光',
              value: 'ICL_zh_female_yry_tob',
            },
            {
              label: '高冷御姐',
              value: 'zh_female_gaolengyujie_moon_bigtts',
            },
            {
              label: '撒娇女友',
              value: 'zh_female_sajiaonvyou_moon_bigtts',
            },
            {
              label: '活泼刁蛮',
              value: 'ICL_zh_female_huopodiaoman_tob',
            },
            {
              label: '傲慢娇声',
              value: 'ICL_zh_female_aomanjiaosheng_tob',
            },
            {
              label: '暖心学姐',
              value: 'ICL_zh_female_nuanxinxuejie_tob',
            },
            {
              label: '成熟姐姐',
              value: 'ICL_zh_female_chengshujiejie_tob',
            },
            {
              label: '妩媚御姐',
              value: 'ICL_zh_female_wumeiyujie_tob',
            },
            {
              label: '傲娇女友',
              value: 'ICL_zh_female_aojiaonvyou_tob',
            },
            {
              label: '妩媚可人',
              value: 'ICL_zh_female_ganli_v1_tob',
            },
            {
              label: '邪魅御姐',
              value: 'ICL_zh_female_xiangliangya_v1_tob',
            },
            {
              label: '性感御姐',
              value: 'ICL_zh_female_xingganyujie_tob',
            },
            {
              label: '性感魅惑',
              value: 'ICL_zh_female_luoqing_v1_tob',
            },
            {
              label: '假小子',
              value: 'ICL_zh_female_jiaxiaozi_tob',
            },
          ],
        },
        emotion: {
          type: 'select',
          label: {
            en: 'Emotion',
            zh: '情感',
          },
          initialValue: 'hate',
          span: 8,
          options: [
            {
              label: '快乐 (Happy)',
              value: 'happy',
            },
            {
              label: '憎恨（Hate）',
              value: 'hate',
            },
            {
              label: '悲伤 (Sad)',
              value: 'sad',
            },
          ],
        },
        speedRatio: {
          type: 'number',
          label: {
            en: 'Speed Ratio',
            zh: '语速',
          },
          required: false,
          span: 8,
          initialValue: 1.2,
          min: 0.5,
          max: 2.0,
          step: 0.1,
        },
      },
    },
  },
};
