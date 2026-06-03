/**
 * Email templates — HTML generators for transactional emails.
 */

interface OtpEmailParams {
  code: string;
  name?: string;
}

/**
 * Generate a password-recovery OTP email HTML body.
 */
export function otpEmailHtml({ code, name }: OtpEmailParams): string {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const title = "Reset your password";
  const message = "Use this code to reset your password:";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
      <div style="max-width: 480px; margin: 0 auto; text-align: center;">
        <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #ffffff;">${title}</h1>
        <p style="color: #a3a3a3; margin-bottom: 8px;">${greeting}</p>
        <p style="color: #a3a3a3; margin-bottom: 32px;">${message}</p>
        <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px; margin-bottom: 32px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #ffffff;">${code}</span>
        </div>
        <p style="color: #737373; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore it.</p>
      </div>
    </body>
    </html>
  `.trim();
}
