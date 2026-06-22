import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 修正 VS Code active editor 路径的大小写残留。
 *
 * macOS 下 `activeTextEditor.document.fileName` / `uri.fsPath` 会缓存文件改名前的
 * 旧大小写——macOS FSEvents 对"纯大小写改名"不触发事件(VS Code #236573),VS Code
 * 收不到通知,路径大小写停留在改名前。本函数 readdir 父目录,用 FS 真实存储的
 * basename 修正大小写,让根节点跟随实际文件名。
 *
 * 在 Windows(大小写不敏感)同理;Linux(大小写敏感)readdir 返回即真实,无需修正但无害。
 */
export function resolveRealCasePath(filePath: string): string {
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const real = fs.readdirSync(dir).find((e) => e.toLowerCase() === base.toLowerCase());
    return real && real !== base ? path.join(dir, real) : filePath;
  } catch {
    // 父目录不可达时保留原值
    return filePath;
  }
}
