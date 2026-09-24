export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      await ensureDatabase(env.DB);

      // =========================
      // API: TEST
      // =========================

      if (url.pathname === "/api/test") {
        const result = await env.DB
          .prepare("SELECT 1 AS ok")
          .first();

        return json({
          success: true,
          database: "connected",
          result
        });
      }


      // =========================
      // API: REGISTER / GET USER
      // =========================

      if (
        url.pathname === "/api/user" &&
        request.method === "POST"
      ) {
        const data = await request.json();

        const user = data.user || {};
        const telegramId = String(user.id || "");

        if (!telegramId) {
          return json(
            {
              success: false,
              error: "Telegram user not found"
            },
            400
          );
        }

        const username = user.username || "";
        const firstName = user.first_name || "";
        const lastName = user.last_name || "";

        const existing = await env.DB
          .prepare(
            "SELECT * FROM users WHERE telegram_id = ?"
          )
          .bind(telegramId)
          .first();

        if (!existing) {
          const referralCode =
            "P2E" +
            telegramId +
            Math.random()
              .toString(36)
              .substring(2, 7)
              .toUpperCase();

          let referredBy = null;

          /*
            Telegram Mini App start parameter.
            Example:
            https://t.me/Play2Earn_Free_bot?startapp=REFCODE
          */
          const startParam =
            String(data.start_param || "").trim();

          if (
            startParam &&
            startParam !== referralCode
          ) {
            const referrer = await env.DB
              .prepare(
                "SELECT telegram_id FROM users WHERE referral_code = ?"
              )
              .bind(startParam)
              .first();

            if (
              referrer &&
              String(referrer.telegram_id) !== telegramId
            ) {
              referredBy = String(referrer.telegram_id);
            }
          }

          await env.DB
            .prepare(`
              INSERT INTO users
              (
                telegram_id,
                username,
                first_name,
                last_name,
                balance,
                total_earned,
                xp,
                level,
                referral_code,
                referred_by,
                referrals_count
              )
              VALUES (?, ?, ?, ?, 0, 0, 0, 1, ?, ?, 0)
            `)
            .bind(
              telegramId,
              username,
              firstName,
              lastName,
              referralCode,
              referredBy
            )
            .run();


          /*
            Give referral credit only once,
            when a new user joins.
          */

          if (referredBy) {
            const referralReward = 0.01;

            await env.DB
              .prepare(`
                UPDATE users
                SET
                  referrals_count = referrals_count + 1,
                  updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = ?
              `)
              .bind(referredBy)
              .run();

            await env.DB
              .prepare(`
                UPDATE users
                SET
                  balance = balance + ?,
                  total_earned = total_earned + ?,
                  xp = xp + 10,
                  updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = ?
              `)
              .bind(
                referralReward,
                referralReward,
                referredBy
              )
              .run();

            await env.DB
              .prepare(`
                INSERT INTO transactions
                (
                  telegram_id,
                  type,
                  amount,
                  description
                )
                VALUES (?, 'referral', ?, ?)
              `)
              .bind(
                referredBy,
                referralReward,
                "Referral reward"
              )
              .run();
          }
        } else {
          await env.DB
            .prepare(`
              UPDATE users
              SET
                username = ?,
                first_name = ?,
                last_name = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE telegram_id = ?
            `)
            .bind(
              username,
              firstName,
              lastName,
              telegramId
            )
            .run();
        }

        const finalUser = await env.DB
          .prepare(
            "SELECT * FROM users WHERE telegram_id = ?"
          )
          .bind(telegramId)
          .first();

        return json({
          success: true,
          user: finalUser
        });
      }


      if (
        url.pathname === "/api/user" &&
        request.method === "GET"
      ) {
        const telegramId =
          url.searchParams.get("telegram_id");

        if (!telegramId) {
          return json(
            {
              success: false,
              error: "telegram_id is required"
            },
            400
          );
        }

        const user = await env.DB
          .prepare(
            "SELECT * FROM users WHERE telegram_id = ?"
          )
          .bind(String(telegramId))
          .first();

        if (!user) {
          return json(
            {
              success: false,
              error: "User not found"
            },
            404
          );
        }

        return json({
          success: true,
          user
        });
      }


      // =========================
      // API: TASKS
      // =========================

      if (
        url.pathname === "/api/tasks" &&
        request.method === "GET"
      ) {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              title,
              description,
              reward,
              type,
              url,
              icon
            FROM tasks
            WHERE active = 1
            ORDER BY id DESC
          `)
          .all();

        return json({
          success: true,
          tasks: result.results || []
        });
      }


      // =========================
      // API: COMPLETE TASK
      // =========================

      if (
        url.pathname === "/api/tasks/complete" &&
        request.method === "POST"
      ) {
        const data = await request.json();

        const telegramId =
          String(data.telegram_id || "");

        const taskId =
          Number(data.task_id);

        if (!telegramId || !taskId) {
          return json(
            {
              success: false,
              error:
                "telegram_id and task_id are required"
            },
            400
          );
        }

        const user = await env.DB
          .prepare(
            "SELECT * FROM users WHERE telegram_id = ?"
          )
          .bind(telegramId)
          .first();

        if (!user) {
          return json(
            {
              success: false,
              error: "User not found"
            },
            404
          );
        }

        const task = await env.DB
          .prepare(`
            SELECT *
            FROM tasks
            WHERE id = ?
            AND active = 1
          `)
          .bind(taskId)
          .first();

        if (!task) {
          return json(
            {
              success: false,
              error: "Task not found"
            },
            404
          );
        }

        const completed = await env.DB
          .prepare(`
            SELECT id
            FROM task_completions
            WHERE telegram_id = ?
            AND task_id = ?
          `)
          .bind(
            telegramId,
            taskId
          )
          .first();

        if (completed) {
          return json(
            {
              success: false,
              error:
                "Task already completed"
            },
            400
          );
        }

        const reward =
          Number(task.reward || 0);

        await env.DB
          .prepare(`
            INSERT INTO task_completions
            (
              telegram_id,
              task_id,
              reward
            )
            VALUES (?, ?, ?)
          `)
          .bind(
            telegramId,
            taskId,
            reward
          )
          .run();

        await env.DB
          .prepare(`
            UPDATE users
            SET
              balance = balance + ?,
              total_earned = total_earned + ?,
              xp = xp + 10,
              updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `)
          .bind(
            reward,
            reward,
            telegramId
          )
          .run();

        await updateLevel(
          env.DB,
          telegramId
        );

        await env.DB
          .prepare(`
            INSERT INTO transactions
            (
              telegram_id,
              type,
              amount,
              description
            )
            VALUES (?, 'task', ?, ?)
          `)
          .bind(
            telegramId,
            reward,
            task.title
          )
          .run();

        const updated = await env.DB
          .prepare(`
            SELECT
              balance,
              total_earned
            FROM users
            WHERE telegram_id = ?
          `)
          .bind(telegramId)
          .first();

        return json({
          success: true,
          reward,
          balance: updated.balance,
          total_earned: updated.total_earned
        });
      }


      // =========================
      // API: DAILY BONUS
      // =========================

      if (
        url.pathname === "/api/daily-bonus" &&
        request.method === "POST"
      ) {
        const data = await request.json();

        const telegramId =
          String(data.telegram_id || "");

        if (!telegramId) {
          return json(
            {
              success: false,
              error: "Telegram user not found"
            },
            400
          );
        }

        const user = await env.DB
          .prepare(
            "SELECT * FROM users WHERE telegram_id = ?"
          )
          .bind(telegramId)
          .first();

        if (!user) {
          return json(
            {
              success: false,
              error: "User not found"
            },
            404
          );
        }

        const today =
          new Date()
            .toISOString()
            .slice(0, 10);

        const alreadyClaimed =
          await env.DB
            .prepare(`
              SELECT id
              FROM daily_bonus_claims
              WHERE telegram_id = ?
              AND claim_date = ?
            `)
            .bind(
              telegramId,
              today
            )
            .first();

        if (alreadyClaimed) {
          return json(
            {
              success: false,
              error:
                "Daily bonus already claimed today"
            },
            400
          );
        }

        const reward = 0.01;

        await env.DB
          .prepare(`
            INSERT INTO daily_bonus_claims
            (
              telegram_id,
              reward,
              claim_date
            )
            VALUES (?, ?, ?)
          `)
          .bind(
            telegramId,
            reward,
            today
          )
          .run();

        await env.DB
          .prepare(`
            UPDATE users
            SET
              balance = balance + ?,
              total_earned = total_earned + ?,
              xp = xp + 5,
              updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `)
          .bind(
            reward,
            reward,
            telegramId
          )
          .run();

        await updateLevel(
          env.DB,
          telegramId
        );

        await env.DB
          .prepare(`
            INSERT INTO transactions
            (
              telegram_id,
              type,
              amount,
              description
            )
            VALUES (?, 'daily_bonus', ?, 'Daily Bonus')
          `)
          .bind(
            telegramId,
            reward
          )
          .run();

        const updated =
          await env.DB
            .prepare(`
              SELECT
                balance,
                total_earned
              FROM users
              WHERE telegram_id = ?
            `)
            .bind(telegramId)
            .first();

        return json({
          success: true,
          reward,
          balance: updated.balance,
          total_earned: updated.total_earned
        });
      }


      // =========================
      // API: GAMES
      // =========================

      if (
        url.pathname === "/api/game/play" &&
        request.method === "POST"
      ) {
        const data = await request.json();

        const telegramId =
          String(data.telegram_id || "");

        const game =
          String(data.game || "");

        if (!telegramId || !game) {
          return json(
            {
              success: false,
              error: "Invalid game request"
            },
            400
          );
        }

        const allowedGames = [
          "spin",
          "scratch",
          "lucky"
        ];

        if (!allowedGames.includes(game)) {
          return json(
            {
              success: false,
              error: "Invalid game"
            },
            400
          );
        }

        const user = await env.DB
          .prepare(
            "SELECT * FROM users WHERE telegram_id = ?"
          )
          .bind(telegramId)
          .first();

        if (!user) {
          return json(
            {
              success: false,
              error: "User not found"
            },
            404
          );
        }

        const today =
          new Date()
            .toISOString()
            .slice(0, 10);

        const played =
          await env.DB
            .prepare(`
              SELECT COUNT(*) AS count
              FROM game_plays
              WHERE telegram_id = ?
              AND game = ?
              AND play_date = ?
            `)
            .bind(
              telegramId,
              game,
              today
            )
            .first();

        if (
          Number(played?.count || 0) >= 1
        ) {
          return json(
            {
              success: false,
              error:
                "You already played this game today."
            },
            400
          );
        }

        /*
          Small random reward.
          This is intentionally low for the MVP.
        */

        const rewards = [
          0.001,
          0.002,
          0.003,
          0.005
        ];

        const reward =
          rewards[
            Math.floor(
              Math.random() *
              rewards.length
            )
          ];

        await env.DB
          .prepare(`
            INSERT INTO game_plays
            (
              telegram_id,
              game,
              reward,
              play_date
            )
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            telegramId,
            game,
            reward,
            today
          )
          .run();

        await env.DB
          .prepare(`
            UPDATE users
            SET
              balance = balance + ?,
              total_earned = total_earned + ?,
              xp = xp + 3,
              updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `)
          .bind(
            reward,
            reward,
            telegramId
          )
          .run();

        await updateLevel(
          env.DB,
          telegramId
        );

        await env.DB
          .prepare(`
            INSERT INTO transactions
            (
              telegram_id,
              type,
              amount,
              description
            )
            VALUES (?, 'game', ?, ?)
          `)
          .bind(
            telegramId,
            reward,
            game + " game reward"
          )
          .run();

        const updated =
          await env.DB
            .prepare(`
              SELECT
                balance,
                total_earned
              FROM users
              WHERE telegram_id = ?
            `)
            .bind(telegramId)
            .first();

        return json({
          success: true,
          reward,
          balance: updated.balance,
          total_earned: updated.total_earned
        });
      }


      // =========================
      // API: REFERRAL
      // =========================

      if (
        url.pathname === "/api/referral" &&
        request.method === "GET"
      ) {
        const telegramId =
          url.searchParams.get(
            "telegram_id"
          );

        if (!telegramId) {
          return json(
            {
              success: false,
              error: "telegram_id required"
            },
            400
          );
        }

        const user = await env.DB
          .prepare(`
            SELECT
              telegram_id,
              referral_code,
              referrals_count
            FROM users
            WHERE telegram_id = ?
          `)
          .bind(String(telegramId))
          .first();

        if (!user) {
          return json(
            {
              success: false,
              error: "User not found"
            },
            404
          );
        }

        const botUsername =
          "Play2Earn_Free_bot";

        const link =
          "https://t.me/" +
          botUsername +
          "?startapp=" +
          encodeURIComponent(
            user.referral_code
          );

        const earned =
          await env.DB
            .prepare(`
              SELECT
                COALESCE(
                  SUM(amount),
                  0
                ) AS earned
              FROM transactions
              WHERE telegram_id = ?
              AND type = 'referral'
            `)
            .bind(String(telegramId))
            .first();

        return json({
          success: true,
          referral: {
            link,
            referral_code:
              user.referral_code,
            referrals_count:
              user.referrals_count || 0,
            earned:
              earned?.earned || 0
          }
        });
      }


      // =========================
      // API: WITHDRAW
      // =========================

      if (
        url.pathname === "/api/withdraw" &&
        request.method === "POST"
      ) {
        const data = await request.json();

        const telegramId =
          String(data.telegram_id || "");

        const amount =
          Number(data.amount || 0);

        const method =
          String(data.method || "").trim();

        const account =
          String(data.account || "").trim();

        const MIN_WITHDRAW = 0.10;

        if (!telegramId) {
          return json(
            {
              success: false,
              error: "User not found"
            },
            400
          );
        }

        if (
          !amount ||
          amount < MIN_WITHDRAW
        ) {
          return json(
            {
              success: false,
              error:
                "Minimum withdrawal is $0.10"
            },
            400
          );
        }

        if (!method || !account) {
          return json(
            {
              success: false,
              error:
                "Payment method and account are required"
            },
            400
          );
        }

        const user = await env.DB
          .prepare(
            "SELECT * FROM users WHERE telegram_id = ?"
          )
          .bind(telegramId)
          .first();

        if (!user) {
          return json(
            {
              success: false,
              error: "User not found"
            },
            404
          );
        }

        const balance =
          Number(user.balance || 0);

        if (amount > balance) {
          return json(
            {
              success: false,
              error: "Insufficient balance"
            },
            400
          );
        }

        await env.DB
          .prepare(`
            INSERT INTO withdrawals
            (
              telegram_id,
              amount,
              method,
              account,
              status
            )
            VALUES (?, ?, ?, ?, 'pending')
          `)
          .bind(
            telegramId,
            amount,
            method,
            account
          )
          .run();

        await env.DB
          .prepare(`
            UPDATE users
            SET
              balance = balance - ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `)
          .bind(
            amount,
            telegramId
          )
          .run();

        await env.DB
          .prepare(`
            INSERT INTO transactions
            (
              telegram_id,
              type,
              amount,
              description
            )
            VALUES (?, 'withdraw', ?, ?)
          `)
          .bind(
            telegramId,
            -amount,
            "Withdrawal request"
          )
          .run();

        const updated =
          await env.DB
            .prepare(`
              SELECT
                balance,
                total_earned
              FROM users
              WHERE telegram_id = ?
            `)
            .bind(telegramId)
            .first();

        return json({
          success: true,
          balance: updated.balance,
          total_earned:
            updated.total_earned
        });
      }


      // =========================
      // API: WITHDRAW HISTORY
      // =========================

      if (
        url.pathname ===
          "/api/withdraw/history" &&
        request.method === "GET"
      ) {
        const telegramId =
          url.searchParams.get(
            "telegram_id"
          );

        if (!telegramId) {
          return json(
            {
              success: false,
              error: "telegram_id required"
            },
            400
          );
        }

        const result =
          await env.DB
            .prepare(`
              SELECT
                id,
                amount,
                method,
                account,
                status,
                created_at
              FROM withdrawals
              WHERE telegram_id = ?
              ORDER BY id DESC
              LIMIT 50
            `)
            .bind(String(telegramId))
            .all();

        return json({
          success: true,
          withdrawals:
            result.results || []
        });
      }


      // =========================
      // API: LEADERBOARD
      // =========================

      if (
        url.pathname ===
          "/api/leaderboard" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB
            .prepare(`
              SELECT
                first_name,
                username,
                total_earned,
                level
              FROM users
              ORDER BY total_earned DESC
              LIMIT 20
            `)
            .all();

        return json({
          success: true,
          leaderboard:
            result.results || []
        });
      }


      // =========================
      // STATIC ASSETS
      // =========================

      return env.ASSETS.fetch(request);

    } catch (error) {

      console.error(error);

      return json(
        {
          success: false,
          error: error.message || "Server error"
        },
        500
      );
    }
  }
};


/* =========================================
   DATABASE SETUP
========================================= */

async function ensureDatabase(DB) {

  /*
    Existing tables are preserved.
    New tables are created automatically.
  */

  await DB.batch([

    DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        balance REAL DEFAULT 0,
        total_earned REAL DEFAULT 0,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        referral_code TEXT UNIQUE,
        referred_by TEXT,
        referrals_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `),

    DB.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        reward REAL DEFAULT 0,
        type TEXT DEFAULT 'daily',
        url TEXT,
        icon TEXT DEFAULT '🎯',
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `),

    DB.prepare(`
      CREATE TABLE IF NOT EXISTS task_completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        reward REAL DEFAULT 0,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(telegram_id, task_id)
      )
    `),

    DB.prepare(`
      CREATE TABLE IF NOT EXISTS daily_bonus_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        reward REAL NOT NULL,
        claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        claim_date TEXT
      )
    `),

    DB.prepare(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL DEFAULT 0,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `),

    DB.prepare(`
      CREATE TABLE IF NOT EXISTS game_plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        game TEXT NOT NULL,
        reward REAL DEFAULT 0,
        play_date TEXT NOT NULL,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `),

    DB.prepare(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        amount REAL NOT NULL,
        method TEXT NOT NULL,
        account TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      )
    `)

  ]);


  /*
    Safe indexes.
  */

  await DB.batch([

    DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      daily_bonus_user_date
      ON daily_bonus_claims
      (telegram_id, claim_date)
    `),

    DB.prepare(`
      CREATE INDEX IF NOT EXISTS
      transactions_user
      ON transactions
      (telegram_id)
    `),

    DB.prepare(`
      CREATE INDEX IF NOT EXISTS
      withdrawals_user
      ON withdrawals
      (telegram_id)
    `),

    DB.prepare(`
      CREATE INDEX IF NOT EXISTS
      games_user_date
      ON game_plays
      (telegram_id, game, play_date)
    `)

  ]);


  /*
    Insert default tasks only if
    there are no tasks yet.
  */

  const taskCount =
    await DB
      .prepare(
        "SELECT COUNT(*) AS count FROM tasks"
      )
      .first();


  if (
    Number(taskCount?.count || 0) === 0
  ) {

    await DB.batch([

      DB.prepare(`
        INSERT INTO tasks
        (
          title,
          description,
          reward,
          type,
          url,
          icon
        )
        VALUES
        (
          'Daily Bonus',
          'Claim your daily reward',
          0.01,
          'daily',
          '#',
          '🎁'
        )
      `),

      DB.prepare(`
        INSERT INTO tasks
        (
          title,
          description,
          reward,
          type,
          url,
          icon
        )
        VALUES
        (
          'Visit Website',
          'Visit our partner website',
          0.005,
          'website',
          '#',
          '🌐'
        )
      `),

      DB.prepare(`
        INSERT INTO tasks
        (
          title,
          description,
          reward,
          type,
          url,
          icon
        )
        VALUES
        (
          'Watch & Earn',
          'Watch the required video',
          0.02,
          'video',
          '#',
          '🎬'
        )
      `)

    ]);

  }

}


/* =========================================
   LEVEL SYSTEM
========================================= */

async function updateLevel(
  DB,
  telegramId
) {

  const user =
    await DB
      .prepare(`
        SELECT xp
        FROM users
        WHERE telegram_id = ?
      `)
      .bind(telegramId)
      .first();

  if (!user) {
    return;
  }

  const xp =
    Number(user.xp || 0);

  /*
    Every 100 XP = next level.
  */

  const level =
    Math.floor(xp / 100) + 1;

  await DB
    .prepare(`
      UPDATE users
      SET level = ?
      WHERE telegram_id = ?
    `)
    .bind(
      level,
      telegramId
    )
    .run();
}


/* =========================================
   JSON RESPONSE
========================================= */

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",
        "Cache-Control":
          "no-store"
      }
    }
  );

}
