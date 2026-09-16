/**
 * 邮件模板定义与生成模块
 */

export interface MailTemplate {
  subject: string;
  text: string;
  html: string;
}

/**
 * 生成邮箱验证邮件模板（含纯文本及 HTML 版本）
 */
export function verificationEmail(url: string): MailTemplate {
  const safeUrl = url.replace(/"/g, "&quot;");
  const subject = "验证邮箱";
  const text = `你正在注册 SM 服务中心账号，请访问以下链接完成邮箱验证：\n${url}\n\n此链接有效期为 1 小时。如非本人操作，请忽略此邮件。`;
  const html = `<div style="max-width:480px;margin:0 auto;font-family:sans-serif;color:#333;line-height:1.6;">
  <h2 style="font-size:20px;font-weight:600;margin-bottom:16px;color:#111;">验证你的邮箱</h2>
  <p>你正在注册 SM 服务中心账号，请点击下方按钮完成邮箱验证：</p>
  <p style="text-align:center;margin:24px 0;">
    <a href="${safeUrl}" style="display:inline-block;padding:12px 32px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">验证邮箱</a>
  </p>
  <p style="color:#666;font-size:13px;">如果按钮无法点击，请复制以下链接到浏览器打开：</p>
  <p style="word-break:break-all;font-size:13px;color:#1a73e8;">${safeUrl}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">此链接有效期为 1 小时。如非本人操作，请忽略此邮件。</p>
</div>`;
  return { subject, text, html };
}

/**
 * 生成密码重置邮件模板（含纯文本及 HTML 版本）
 */
export function resetPasswordEmail(url: string): MailTemplate {
  const safeUrl = url.replace(/"/g, "&quot;");
  const subject = "重置密码";
  const text = `你正在重置 SM 服务中心账号的密码，请访问以下链接完成重置：\n${url}\n\n此链接有效期为 1 小时。如非本人操作，请忽略此邮件。`;
  const html = `<div style="max-width:480px;margin:0 auto;font-family:sans-serif;color:#333;line-height:1.6;">
  <h2 style="font-size:20px;font-weight:600;margin-bottom:16px;color:#111;">重置你的密码</h2>
  <p>你正在重置 SM 服务中心账号的密码，请点击下方按钮完成重置：</p>
  <p style="text-align:center;margin:24px 0;">
    <a href="${safeUrl}" style="display:inline-block;padding:12px 32px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">重置密码</a>
  </p>
  <p style="color:#666;font-size:13px;">如果按钮无法点击，请复制以下链接到浏览器打开：</p>
  <p style="word-break:break-all;font-size:13px;color:#1a73e8;">${safeUrl}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">此链接有效期为 1 小时。如非本人操作，请忽略此邮件。</p>
</div>`;
  return { subject, text, html };
}
