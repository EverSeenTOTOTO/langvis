// 工具显式注册表（取代运行时 globby 发现 + 构建期 fetchEntries hack）：
// 新增工具目录时在此登记一行。rollup 经静态 import 自动追踪产物。
import Askuser from './AskUser';
import { config as AskuserConfig } from './AskUser/config';
import Bash from './Bash';
import { config as BashConfig } from './Bash/config';
import Callsubagents from './CallSubagents';
import { config as CallsubagentsConfig } from './CallSubagents/config';
import Contentchunk from './ContentChunk';
import { config as ContentchunkConfig } from './ContentChunk/config';
import Datetimeget from './DateTimeGet';
import { config as DatetimegetConfig } from './DateTimeGet/config';
import Documentmetadataextract from './DocumentMetadataExtract';
import { config as DocumentmetadataextractConfig } from './DocumentMetadataExtract/config';
import Documentsearch from './DocumentSearch';
import { config as DocumentsearchConfig } from './DocumentSearch/config';
import Documentstore from './DocumentStore';
import { config as DocumentstoreConfig } from './DocumentStore/config';
import Embeddinggenerate from './EmbeddingGenerate';
import { config as EmbeddinggenerateConfig } from './EmbeddingGenerate/config';
import Fileedit from './FileEdit';
import { config as FileeditConfig } from './FileEdit/config';
import Linksextract from './LinksExtract';
import { config as LinksextractConfig } from './LinksExtract/config';
import Listtools from './ListTools';
import { config as ListtoolsConfig } from './ListTools/config';
import Pdfextract from './PdfExtract';
import { config as PdfextractConfig } from './PdfExtract/config';
import Responseuser from './ResponseUser';
import { config as ResponseuserConfig } from './ResponseUser/config';
import Skillcall from './SkillCall';
import { config as SkillcallConfig } from './SkillCall/config';
import Speechtotext from './SpeechToText';
import { config as SpeechtotextConfig } from './SpeechToText/config';
import Texttospeech from './TextToSpeech';
import { config as TexttospeechConfig } from './TextToSpeech/config';
import Webfetch from './WebFetch';
import { config as WebfetchConfig } from './WebFetch/config';

export const TOOL_REGISTRY = [
  { clazz: Askuser, config: AskuserConfig },
  { clazz: Bash, config: BashConfig },
  { clazz: Callsubagents, config: CallsubagentsConfig },
  { clazz: Contentchunk, config: ContentchunkConfig },
  { clazz: Datetimeget, config: DatetimegetConfig },
  { clazz: Documentmetadataextract, config: DocumentmetadataextractConfig },
  { clazz: Documentsearch, config: DocumentsearchConfig },
  { clazz: Documentstore, config: DocumentstoreConfig },
  { clazz: Embeddinggenerate, config: EmbeddinggenerateConfig },
  { clazz: Fileedit, config: FileeditConfig },
  { clazz: Linksextract, config: LinksextractConfig },
  { clazz: Listtools, config: ListtoolsConfig },
  { clazz: Pdfextract, config: PdfextractConfig },
  { clazz: Responseuser, config: ResponseuserConfig },
  { clazz: Skillcall, config: SkillcallConfig },
  { clazz: Speechtotext, config: SpeechtotextConfig },
  { clazz: Texttospeech, config: TexttospeechConfig },
  { clazz: Webfetch, config: WebfetchConfig },
];
