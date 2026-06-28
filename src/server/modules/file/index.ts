/**
 * file 模块对外边界——文件 I/O 业务逻辑（FileService）+ 上传校验错误类型。
 * 上传限额策略内联于 FileService（saveFile 自校验、抛 FileValidationError）。
 * controller/FileController 与测试从此导入。
 */
export { FileService, FileValidationError } from './file.service';
