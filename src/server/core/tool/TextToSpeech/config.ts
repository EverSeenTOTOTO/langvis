import { ToolConfig } from '@/shared/types';

export const config: ToolConfig<
  {
    text: string;
    reqId: string;
    voice: [
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
    ][number];
    emotion?: [
      'happy',
      'hate',
      'sad',
      'angry',
      'surprised',
      'fear',
      'lovey-dovey',
      'shy',
    ][number];
    speedRatio?: number;
  },
  {
    filename: string;
    voiceType: string;
    filePath: string;
  }
> = {
  name: 'TextToSpeech Tool',
  description: 'Converts text to speech audio file using TTS API.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text content to be converted to speech.',
      },
      reqId: {
        type: 'string',
        description:
          'Unique request identifier used for tracking. Also used as output filename.',
      },
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
        description: 'Voice type to use for synthesis.',
      },
      emotion: {
        type: 'string',
        enum: [
          'happy',
          'hate',
          'sad',
          'angry',
          'surprised',
          'fear',
          'lovey-dovey',
          'shy',
        ],
        default: 'hate',
        description: 'Emotional tone for the speech synthesis.',
        nullable: true,
      },
      speedRatio: {
        type: 'number',
        default: 1.2,
        minimum: 0.5,
        maximum: 2.0,
        description: 'Speech speed ratio between 0.5 (slow) and 2.0 (fast).',
        nullable: true,
      },
    },
    required: ['text', 'reqId', 'voice'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'The generated audio file name (format: {reqId}.mp3).',
      },
      voiceType: {
        type: 'string',
        description: 'The actual voice type used for synthesis.',
      },
      filePath: {
        type: 'string',
        description: 'Relative path to the generated audio file.',
      },
    },
    required: ['filename', 'voiceType', 'filePath'],
  },
};
