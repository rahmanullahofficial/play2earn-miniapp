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

    // Get user
    if (url.pathname === "/api/user" && request.method === "GET") {
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
    }

    // Get active tasks
    if (url.pathname === "/api/tasks" && request.method === "GET") {
      try {
        const result = await env.DB
          .prepare(`
            SELECT id, title, description, reward, type, url, icon
            FROM tasks
            WHERE active = 1
            ORDER BY id DESC
          `)
          .all();

        return Response.json({
          success: true,
          tasks: result.results
        });

      } catch (error) {
        return Response.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }
    }
// Complete task and reward user
if (url.pathname === "/api/tasks/complete" && request.method === "POST") {
  try {
    const data = await request.json();

    const telegramId = String(data.telegram_id || "");
    const taskId = Number(data.task_id);

    if (!telegramId || !taskId) {
      return Response.json(
        { success: false, error: "telegram_id and task_id are required" },
        { status: 400 }
      );
    }

    // Get task
    const task = await env.DB
      .prepare("SELECT * FROM tasks WHERE id = ? AND active = 1")
      .bind(taskId)
      .first();

    if (!task) {
      return Response.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    // Check if already completed
    const completed = await env.DB
      .prepare(`
        SELECT id FROM task_completions
        WHERE telegram_id = ? AND task_id = ?
      `)
      .bind(telegramId, taskId)
      .first();

    if (completed) {
      return Response.json({
        success: false,
        error: "Task already completed"
      }, { status: 400 });
    }

    // Add completion record
    await env.DB
      .prepare(`
        INSERT INTO task_completions
        (telegram_id, task_id, reward)
        VALUES (?, ?, ?)
      `)
      .bind(telegramId, taskId, task.reward)
      .run();

    // Add reward to balance
    await env.DB
      .prepare(`
        UPDATE users
        SET
          balance = balance + ?,
          total_earned = total_earned + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = ?
      `)
      .bind(task.reward, task.reward, telegramId)
      .run();

    // Get updated balance
    const user = await env.DB
      .prepare(`
        SELECT balance, total_earned
        FROM users
        WHERE telegram_id = ?
      `)
      .bind(telegramId)
      .first();

    return Response.json({
      success: true,
      reward: task.reward,
      balance: user.balance,
      total_earned: user.total_earned
    });

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}
    // Database test
    if (url.pathname === "/api/test") {
      const result = await env.DB
        .prepare("SELECT 1 AS ok")
        .first();

      return Response.json({
        success: true,
        database: "connected",
        result
      });
    }

    return env.ASSETS.fetch(request);
  }
};
