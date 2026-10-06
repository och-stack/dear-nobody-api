const express = require("express");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

dotenv.config();

const app = express();

// allow JSON body request and request from frontend
app.use(express.json());
app.use(cors());

// supabase connection
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

// API documentation
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

        // Hash the password before saving to the database
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert the new user into the users table
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
        console.log("ERROR CODE:", error.code);
        console.log("ERROR CONSTRAINT:", error.constraint);
        console.log("ERROR DETAIL:", error.detail);
        console.log("ERROR MESSAGE:", error.message);

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

        // Find the user by email
        const result = await pool.query(
            `
      SELECT *
      FROM users
      WHERE email = $1;
      `,
            [email]
        );

        // stop if email does not exist
        if (result.rows.length === 0) {
            return res.status(401).json({
                error: "Invalid email or password",
            });
        }

        const user = result.rows[0];

        // compare the entered password with the hashed password
        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                error: "Invalid email or password",
            });
        }

        // create a JWT token containing the user's information
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
// verify the JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            error: "Authentication token is required",
        });
    }

    // get the token from "Bearer TOKEN"
    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            error: "Invalid authentication token",
        });
    }

    try {
        // verify if the token is valid
        const user = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // store the logged-in user's information in req.user
        req.user = user;

        // continue to the protected route
        next();
    } catch (error) {
        return res.status(401).json({
            error: "Invalid or expired authentication token",
        });
    }
}

// Get users except logged-in user
app.get("/users", authenticateToken, async (req, res) => {
    try {
        // get logged-in user from the JWT token
        const userId = req.user.id;

        const result = await pool.query(
            `
      SELECT
        users.id,
        users.username,
        users.email,
        users.created_at,
        friendships.id AS friendship_id,
        friendships.status AS friendship_status,
        CASE
          WHEN friendships.user_id = $1 THEN 'outgoing'
          WHEN friendships.friend_id = $1 THEN 'incoming'
          ELSE NULL
        END AS friendship_direction
      FROM users
      LEFT JOIN friendships
        ON (
          friendships.user_id = $1
          AND friendships.friend_id = users.id
        )
        OR (
          friendships.user_id = users.id
          AND friendships.friend_id = $1
        )
      WHERE users.id != $1
      ORDER BY users.id;
      `,
            [userId]
        );

        res.json(result.rows);
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Failed to get users",
        });
    }
});

// Send friend request
app.post("/friends", authenticateToken, async (req, res) => {
    try {
        // get the logged-in user's ID
        const userId = req.user.id;
        const { friend_id } = req.body;

        // check that a friend ID was provided
        if (!friend_id) {
            return res.status(400).json({
                error: "Friend ID is required",
            });
        }

        // prevent users from adding themselves
        if (userId === Number(friend_id)) {
            return res.status(400).json({
                error: "You cannot add yourself as a friend",
            });
        }

        // check if the selected user exists
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

        // create a new friend request with pending status
        const result = await pool.query(
            `
      INSERT INTO friendships
      (user_id, friend_id, status)
      VALUES ($1, $2, 'pending')
      RETURNING *;
      `,
            [userId, friend_id]
        );

        res.status(201).json({
            message: "Friend request sent",
            friendship: result.rows[0],
        });
    } catch (error) {
        console.log(error);

        // 23505 means the friendship already exists
        if (error.code === "23505") {
            return res.status(400).json({
                error: "Friendship already exists",
            });
        }

        res.status(500).json({
            error: "Failed to send friend request",
        });
    }
});

// Accept friend request (what-if)
app.put("/friends/:id", authenticateToken, async (req, res) => {
    try {
        // get the friendship id and logged-id from the URL
        const friendshipId = req.params.id;
        const userId = req.user.id;
        // change the status from pending to accepted
        const result = await pool.query(
            `
      UPDATE friendships
      SET status = 'accepted'
      WHERE id = $1
        AND friend_id = $2
        AND status = 'pending'
      RETURNING *;
      `,
            [friendshipId, userId]
        );

        // if the request not found
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Friend request not found",
            });
        }

        res.json({
            message: "Friend request accepted",
            friendship: result.rows[0],
        });
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Failed to accept friend request",
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
            AND friendships.status = 'accepted'
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