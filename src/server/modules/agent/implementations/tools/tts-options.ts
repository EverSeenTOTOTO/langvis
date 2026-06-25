/**
 * TTS 共享选项——`text_to_speech` 与 `response_user`（tts 配置）复用，
 * 避免语音/情绪枚举在多处重复。
 */
export const TTS_VOICES = [
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
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export const TTS_EMOTIONS = [
  'happy',
  'hate',
  'sad',
  'angry',
  'surprised',
  'fear',
  'lovey-dovey',
  'shy',
] as const;
export type TtsEmotion = (typeof TTS_EMOTIONS)[number];
