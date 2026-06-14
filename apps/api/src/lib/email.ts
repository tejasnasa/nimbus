import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPasswordResetEmail({
  to,
  url,
}: {
  to: string;
  url: string;
}) {
  await resend.emails.send({
    from: "noreply@tejasnasa.me",
    to,
    subject: "Reset your Nimbus Password",
    html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin: 0; padding: 0; background-color: #1c1624; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1c1624; padding: 48px 16px;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%;">
            <tr>
              <td align="center" style="padding-bottom: 32px;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="text-align: center; vertical-align: middle; padding-right: 12px;">
                      <span style="font-size: 36px; line-height: 1; display: block;">☁️</span>
                    </td>
                    <td style="vertical-align: middle;">
                      <span style="font-size: 22px; font-weight: 700; color: #f8f8f8; letter-spacing: -0.5px;">Nimbus</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color: #271d32; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); padding: 40px 40px 36px;">
                <p style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #f8f8f8; letter-spacing: -0.3px;">Reset your password</p>
                <p style="margin: 0 0 28px; font-size: 15px; color: #a78aba; line-height: 1.6;">
                  We received a request to reset your Nimbus password. Click the button below to choose a new one. This link expires in 1 hour.
                </p>
                <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                  <tr>
                    <td style="background-color: #6d28d9; border-radius: 10px;">
                      <a href="${url}" style="display: inline-block; padding: 13px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
                        Reset Password →
                      </a>
                    </td>
                  </tr>
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                  <tr>
                    <td style="border-top: 1px solid rgba(255,255,255,0.07); height: 1px; font-size: 0;">&nbsp;</td>
                  </tr>
                </table>
                <p style="margin: 0 0 6px; font-size: 12px; color: #6b5f7a;">Or copy and paste this link into your browser:</p>
                <p style="margin: 0; font-size: 12px; color: #6d28d9; word-break: break-all;">${url}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top: 28px;">
                <p style="margin: 0 0 4px; font-size: 12px; color: #4e4460;">If you didn't request a password reset, you can safely ignore this email.</p>
                <p style="margin: 0; font-size: 12px; color: #4e4460;">© 2026 Nimbus · <a href="https://nimbus.tejasnasa.me" style="color: #4e4460;">nimbus.tejasnasa.me</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  });
}

export async function sendEmail({ to, url }: { to: string; url: string }) {
  await resend.emails.send({
    from: "noreply@tejasnasa.me",
    to,
    subject: "Verify your Nimbus Email Address",
    html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin: 0; padding: 0; background-color: #1c1624; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1c1624; padding: 48px 16px;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%;">
            <tr>
              <td align="center" style="padding-bottom: 32px;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="text-align: center; vertical-align: middle; padding-right: 12px;">
                      <span style="font-size: 36px; line-height: 1; display: block;">☁️</span>
                    </td>
                    <td style="vertical-align: middle;">
                      <span style="font-size: 22px; font-weight: 700; color: #f8f8f8; letter-spacing: -0.5px;">Nimbus</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color: #271d32; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); padding: 40px 40px 36px;">
                <p style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #f8f8f8; letter-spacing: -0.3px;">Verify your email address</p>
                <p style="margin: 0 0 28px; font-size: 15px; color: #a78aba; line-height: 1.6;">
                  Thanks for signing up for Nimbus. Just one step left: verify your email to activate your account.
                </p>
                <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                  <tr>
                    <td style="background-color: #6d28d9; border-radius: 10px;">
                      <a href="${url}" style="display: inline-block; padding: 13px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
                        Verify My Email →
                      </a>
                    </td>
                  </tr>
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                  <tr>
                    <td style="border-top: 1px solid rgba(255,255,255,0.07); height: 1px; font-size: 0;">&nbsp;</td>
                  </tr>
                </table>
                <p style="margin: 0 0 6px; font-size: 12px; color: #6b5f7a;">Or copy and paste this link into your browser:</p>
                <p style="margin: 0; font-size: 12px; color: #6d28d9; word-break: break-all;">${url}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top: 28px;">
                <p style="margin: 0 0 4px; font-size: 12px; color: #4e4460;">If you didn't sign up for Nimbus, you can safely ignore this email.</p>
                <p style="margin: 0; font-size: 12px; color: #4e4460;">© 2026 Nimbus · <a href="https://nimbus.tejasnasa.me" style="color: #4e4460;">nimbus.tejasnasa.me</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  });
}
