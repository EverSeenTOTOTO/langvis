import { ToolConfig } from '@/shared/types';

export const config: ToolConfig = {
  name: {
    en: 'TextToSpeech Tool',
    zh: '文本转语音工具',
  },
  description: {
    en: 'Converts text to speech audio file using TTS API. Supports multiple Chinese voices with emotion and speed control.',
    zh: '使用 TTS API 将文本转换为语音音频文件。支持多种中文音声，可控制情感和语速。',
  },
  input: {
    description: {
      en: 'Input parameters for text-to-speech conversion',
      zh: '文本转语音转换的输入参数',
    },
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: {
          en: 'The text content to be converted to speech. Must not be empty or contain only whitespace.',
          zh: '要转换为语音的文本内容。不能为空或只包含空白字符。',
        },
      },
      reqId: {
        type: 'string',
        required: true,
        description: {
          en: 'Unique request identifier used for tracking and voice selection. Also used as the output filename.',
          zh: '用于跟踪和音声选择的唯一请求标识符。同时用作输出文件名。',
        },
      },
      voice: {
        type: 'string',
        required: true,
        description: {
          en: 'Specific voice type to use. If not provided or invalid, a voice will be automatically selected based on reqId hash.',
          zh: '要使用的特定音声类型。如果未提供或无效，将根据 reqId 哈希自动选择音声。',
        },
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
        type: 'string',
        required: false,
        default: 'hate',
        description: {
          en: 'Emotional tone for the speech synthesis. Available options: hate, happy, sad, angry, surprised, fearful, disgusted.',
          zh: '语音合成的情感色调。可用选项：hate, happy, sad, angry, surprised, fearful, disgusted。',
        },
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
          {
            label: '愤怒 (Angry)',
            value: 'angry',
          },
          {
            label: '惊讶 (Surprised)',
            value: 'surprised',
          },
          {
            label: '恐惧 (Fear)',
            value: 'fear',
          },
          {
            label: '撒娇 (Lovely)',
            value: 'lovey-dovey',
          },
          {
            label: '害羞（Shy）',
            value: 'shy',
          },
        ],
      },
      speedRatio: {
        type: 'number',
        required: false,
        default: 1.2,
        range: '0.5-2.0',
        description: {
          en: 'Speech speed ratio. Values between 0.5 (slow) and 2.0 (fast). Default is 1.2.',
          zh: '语音速度比率。值范围 0.5（慢）到 2.0（快）。默认值为 1.2。',
        },
      },
    },
  },
  output: {
    description: {
      en: 'Output information for the generated audio file',
      zh: '生成音频文件的输出信息',
    },
    parameters: {
      filename: {
        type: 'string',
        description: {
          en: 'The generated audio file name (format: {reqId}.mp3)',
          zh: '生成的音频文件名（格式：{reqId}.mp3）',
        },
      },
      voiceType: {
        type: 'string',
        description: {
          en: 'The actual voice type used for synthesis (may differ from input if auto-selected)',
          zh: '用于合成的实际音声类型（如果自动选择可能与输入不同）',
        },
      },
      filePath: {
        type: 'string',
        description: {
          en: 'Relative path to the generated audio file (format: tts/{filename})',
          zh: '生成音频文件的相对路径（格式：tts/{filename}）',
        },
      },
    },
  },
};
