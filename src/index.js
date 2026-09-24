export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Register Telegram user
    if (url.pathname === "/api/user" && request.method === "POST") {
      try {
        const data = await request.json();
        const user = data.user;

        if (!user || !user.id) {
          return Response.json(
            { success: false, error: "Telegram user not found" },
            { status: 400 }
          );
        }

        const telegramId = String(user.id);

        const existing = await env.DB
          .prepare("SELECT * FROM users WHERE telegram_id = ?")
          .bind(telegramId)
          .first();

        if (!existing) {
          const referralCode = "P2E" + telegramId;

          await env.DB
            .prepare(`
              INSERT INTO users
              (telegram_id, username, first_name, last_name, referral_code)
              VALUES (?, ?, ?, ?, ?)
            `)
            .bind(
              telegramId,
              user.username || null,
              user.first_name || null,
              user.last_name || null,
              referralCode
            )
            .run();
        }

        const savedUser = await env.DB
          .prepare("SELECT * FROM users WHERE telegram_id = ?")
          .bind(telegramId)
          .first();

        return Response.json({
          success: true,
          user: savedUser
        });

      } catch (error) {
        return Response.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }
    }

    // Get user balance and profile
    if (url.pathname === "/api/user" && request.method === "GET") {
      try {
        const telegramId = url.searchParams.get("telegram_id");

        if (!telegramId) {
          return Response.json(
            { success: false, error: "telegram_id is required" },
            { status: 400 }
          );
        }

        const user = await env.DB
          .prepare("SELECT * FROM users WHERE telegram_id = ?")
          .bind(telegramId)
          .first();

        if (!user) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 404 }
          );
        }

        return Response.json({
          success: true,
          user
        });

      } catch (error) {
        return Response.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }
    }

    // Database test
    if (url.pathname === "/api/test") {
      try {
        const result = await env.DB
          .prepare("SELECT 1 AS ok")
          .first();

        return Response.json({
          success: true,
          database: "connected",
          result
        });
      } catch (error) {
        return Response.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
