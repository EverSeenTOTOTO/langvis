import { ToolIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  name: {
    en: 'GirlFriend Agent',
    zh: '缓解性压抑智能体',
  },
  description: {
    en: 'A conversational agent that engages in natural dialogue with users, maintaining conversation history and context for coherent responses.',
    zh: '与用户进行自然对话的会话智能体，维护对话历史和上下文以提供连贯的回应。',
  },
  tools: [ToolIds.TEXT_TO_SPEECH],
  configItems: [
    {
      type: 'group',
      name: 'tts',
      label: {
        en: 'Text-to-Speech Settings',
        zh: '文本转语音设置',
      },
      children: [
        {
          type: 'select',
          name: 'voice',
          label: {
            en: 'Voice Type',
            zh: '音色',
          },
          required: true,
          span: 8,
          options: [
            {
              label: '温柔女友',
              value: 'zh_female_roumeinvyou_emo_v2_mars_bigtts',
            },
            {
              label: '魅力女友',
              value: 'zh_female_meilinvyou_emo_v2_mars_bigtts',
            },
            {
              label: '高冷御姐',
              value: 'zh_female_gaolengyujie_emo_v2_mars_bigtts',
            },
          ],
        },
        {
          type: 'select',
          name: 'emotion',
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
        {
          type: 'number',
          name: 'speedRatio',
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
      ],
    },
  ],
};
