/**
 * file 模块对外边界——文件 I/O 业务逻辑（FileService）+ 上传校验错误类型。
 * 上传限额策略源自 shared 的 DEFAULT_UPLOAD_CONFIG（FileService.saveFile 自校验、抛 FileValidationError）；
 * upload 不进入对话配置（非 per-conversation），单一真相源即该常量。
 * controller/FileController 与测试从此导入。
 */
export { FileService, FileValidationError } from './file.service';
