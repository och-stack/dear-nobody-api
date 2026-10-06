const express = require("express");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());


// Supabase connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

// Test the database connection
pool.query("SELECT NOW()", (error) => {
    if (error) {
        console.log("Database connection failed");
    } else {
        console.log("Database connected");
    }
});

// API docs
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Start server
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log(`Dear Nobody API running on port ${PORT}`);
});

// Signup
app.post("/signup", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                error: "Username, email and password are required",
            });
        }

        // handle authentication hashed password
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `
      INSERT INTO users
      (username, email, password)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, created_at;
      `,
            [username, email, hashedPassword]
        );

        res.status(201).json({
            message: "User created successfully",
            user: result.rows[0],
        });
    } catch (error) {
        console.log(error);

        if (error.code === "23505") {
            return res.status(400).json({
                error: "Username or email already exists",
            });
        }

        res.status(500).json({
            error: "Failed to create user",
        });
    }
});

// Login
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: "Email and password are required",
            });
        }

        const result = await pool.query(
            `
      SELECT *
      FROM users
      WHERE email = $1;
      `,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: "Invalid email or password",
            });
        }

        const user = result.rows[0];

        // the server checks and match the stored hashed password
        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                error: "Invalid email or password",
            });
        }

        // after login, generate JWT
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1h",
            }
        );

        res.json({
            message: "Login successful",
            token,
        });
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Failed to login",
        });
    }
});

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            error: "Authentication token is required",
        });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            error: "Invalid authentication token",
        });
    }

    try {
        const user = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = user;

        next();
    } catch (error) {
        return res.status(401).json({
            error: "Invalid or expired authentication token",
        });
    }
}

// get users
app.get("/users", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `
      SELECT
        id,
        username,
        email,
        created_at
      FROM users
      ORDER BY id;
      `
        );

        res.json(result.rows);
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Failed to get users",
        });
    }
});

// Add friends
app.post("/friends", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { friend_id } = req.body;

        if (!friend_id) {
            return res.status(400).json({
                error: "Friend ID is required",
            });
        }

        if (userId === Number(friend_id)) {
            return res.status(400).json({
                error: "You cannot add yourself as a friend",
            });
        }

        const friendResult = await pool.query(
            `
      SELECT id
      FROM users
      WHERE id = $1;
      `,
            [friend_id]
        );

        if (friendResult.rows.length === 0) {
            return res.status(404).json({
                error: "Friend not found",
            });
        }

        const result = await pool.query(
            `
      INSERT INTO friendships
      (user_id, friend_id)
      VALUES ($1, $2)
      RETURNING *;
      `,
            [userId, friend_id]
        );

        res.status(201).json({
            message: "Friend added successfully",
            friendship: result.rows[0],
        });
    } catch (error) {
        console.log(error);

        if (error.code === "23505") {
            return res.status(400).json({
                error: "Friendship already exists",
            });
        }

        res.status(500).json({
            error: "Failed to add friend",
        });
    }
});

// Create posts
app.post("/posts", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { content, visibility } = req.body;

        if (!content || !visibility) {
            return res.status(400).json({
                error: "Content and visibility are required",
            });
        }

        if (!["public", "friends"].includes(visibility)) {
            return res.status(400).json({
                error: "Visibility must be Public or Friends-only",
            });
        }

        const result = await pool.query(
            `
      INSERT INTO posts
      (user_id, content, visibility)
      VALUES ($1, $2, $3)
      RETURNING *;
      `,
            [userId, content, visibility]
        );

        res.status(201).json({
            message: "Post created successfully",
            post: result.rows[0],
        });
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Failed to create post",
        });
    }
});

// Get authorized posts
app.get("/posts", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await pool.query(
            `
      SELECT
        posts.id,
        posts.user_id,
        posts.content,
        posts.visibility,
        posts.created_at,
        users.username
      FROM posts
      JOIN users
        ON posts.user_id = users.id
      WHERE
        posts.visibility = 'public'
        OR posts.user_id = $1
        OR EXISTS (
          SELECT 1
          FROM friendships
          WHERE friendships.user_id = $1
          AND friendships.friend_id = posts.user_id
        )
      ORDER BY posts.created_at ASC;
      `,
            [userId]
        );

        res.json(result.rows);
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Failed to get posts",
        });
    }
});