---
name: PDF处理
description: 读取、合并、拆分PDF文件等操作的工作流指导
---

## PDF处理技能

### 通用步骤

1. **确认文件**：先用 `bash` 检查目标 PDF 文件是否存在、路径是否正确
2. **读取内容**：使用 `bash` 调用 `pdftotext` 或 `python` 脚本提取文本内容
3. **处理内容**：根据用户需求对提取的内容进行分析、总结或转换
4. **输出结果**：将处理结果返回给用户

### 常见操作

- **提取文本**：`pdftotext <file.pdf> -` 输出到 stdout
- **查看页数**：`pdfinfo <file.pdf> | grep Pages`
- **合并PDF**：`pdfunite <1.pdf> <2.pdf> <output.pdf>`
- **拆分页面**：`pdfseparate -f 1 -l 3 <input.pdf> output_%d.pdf`

### 注意事项

- 处理前务必确认文件路径
- 大文件考虑分页处理，避免内存溢出
