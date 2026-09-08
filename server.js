require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* ================================
   CONFIGURATION
================================ */

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "dhasnstpmxtxjkgtjafn";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("");
    console.error("=================================");
    console.error("SUPABASE CONFIGURATION ERROR");
    console.error("=================================");
    console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
    console.error("Check your .env file.");
    console.error("");
    process.exit(1);
}

/* ================================
   SUPABASE
================================ */

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

/* ================================
   MIDDLEWARE
================================ */

app.use(cors());

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

/*
   Serve frontend files from the active runtime directory root.
   Using process.cwd() fixes the Vercel 500 error /var/task issue.
*/
const PUBLIC_DIR = path.join(process.cwd(), "public");
app.use(express.static(PUBLIC_DIR));

/* ================================
   TABLES
================================ */

const tables = [
    "products",
    "sellers",
    "clients",
    "sales"
];

/* ================================
   HELPER FUNCTIONS
================================ */

function sendError(res, error, status = 400) {
    console.error(error);

    res.status(status).json({
        status: false,
        message: error?.message || "Something went wrong"
    });
}

async function getAll(table) {
    const { data, error } = await supabase
        .from(table)
        .select("*")
        .order("created_at", {
            ascending: false
        });

    if (error) {
        throw error;
    }

    return data || [];
}

async function getById(table, id) {
    const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("id", id)
        .single();

    if (error) {
        throw error;
    }

    return data;
}

/* ================================
   HEALTH CHECK
================================ */

app.get("/api/health", (req, res) => {
    res.json({
        status: true,
        service: "baqal-dashboard",
        database: "supabase",
        time: new Date().toISOString()
    });
});

/* ================================
   GENERIC CRUD
================================ */

for (const table of tables) {

    /* ------------------------------
       GET ALL
    ------------------------------ */

    app.get(`/api/${table}`, async (req, res) => {
        try {
            const data = await getAll(table);
            res.json({
                status: true,
                data: data
            });
        } catch (error) {
            console.error(`GET /api/${table}`);
            sendError(res, error, 500);
        }
    });

    /* ------------------------------
       GET ONE
    ------------------------------ */

    app.get(`/api/${table}/:id`, async (req, res) => {
        try {
            const data = await getById(table, req.params.id);
            res.json({
                status: true,
                data: data
            });
        } catch (error) {
            sendError(res, error, 404);
        }
    });

    /* ------------------------------
       CREATE
    ------------------------------ */

    app.post(`/api/${table}`, async (req, res) => {
        try {
            const payload = { ...req.body };

            delete payload.id;
            delete payload.created_at;
            delete payload.updated_at;

            const { data, error } = await supabase
                .from(table)
                .insert(payload)
                .select("*")
                .single();

            if (error) {
                throw error;
            }

            res.status(201).json({
                status: true,
                message: `${table} created successfully`,
                data: data
            });
        } catch (error) {
            console.error(`POST /api/${table}`);
            sendError(res, error);
        }
    });

    /* ------------------------------
       UPDATE
    ------------------------------ */

    app.put(`/api/${table}/:id`, async (req, res) => {
        try {
            const payload = { ...req.body };

            delete payload.id;
            delete payload.created_at;

            payload.updated_at = new Date().toISOString();

            const { data, error } = await supabase
                .from(table)
                .update(payload)
                .eq("id", req.params.id)
                .select("*")
                .single();

            if (error) {
                throw error;
            }

            res.json({
                status: true,
                message: `${table} updated successfully`,
                data: data
            });
        } catch (error) {
            console.error(`PUT /api/${table}/${req.params.id}`);
            sendError(res, error);
        }
    });

    /* ------------------------------
       DELETE
    ------------------------------ */

    app.delete(`/api/${table}/:id`, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from(table)
                .delete()
                .eq("id", req.params.id)
                .select("*");

            if (error) {
                throw error;
            }

            if (!data || data.length === 0) {
                return res.status(404).json({
                    status: false,
                    message: "Record not found"
                });
            }

            res.json({
                status: true,
                message: `${table} deleted successfully`,
                data: data[0]
            });
        } catch (error) {
            console.error(`DELETE /api/${table}/${req.params.id}`);
            sendError(res, error);
        }
    });
}

/* ================================
   NEXT INVOICE NUMBER
================================ */

app.post("/api/next-invoice", async (req, res) => {
    try {
        const { data, error } = await supabase.rpc("next_invoice_no");

        if (error) {
            throw error;
        }

        res.json({
            status: true,
            invoiceNo: data
        });
    } catch (error) {
        console.error("NEXT INVOICE ERROR");
        sendError(res, error, 500);
    }
});

/* ================================
   COMPLETE SALE
================================ */

app.post("/api/sales/complete", async (req, res) => {
    try {
        const sale = req.body;

        if (!sale) {
            return res.status(400).json({
                status: false,
                message: "Sale data is required"
            });
        }

        if (!sale.items || !Array.isArray(sale.items) || sale.items.length === 0) {
            return res.status(400).json({
                status: false,
                message: "Sale must contain at least one item"
            });
        }

        // Inserts transaction block into Supabase sales table
        const { data, error } = await supabase
            .from("sales")
            .insert(sale)
            .select("*")
            .single();

        if (error) {
            throw error;
        }

        res.status(200).json({
            status: true,
            message: "Sale completed successfully",
            data: data
        });

    } catch (error) {
        console.error("COMPLETE SALE ERROR");
        sendError(res, error, 500);
    }
});

/* ================================
   CATCH-ALL FRONTEND ROUTE
================================ */

// Forces Vercel to route client-side requests back to index.html securely
app.get("*", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// App server engine initialization
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
