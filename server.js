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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("");
    console.error("=================================");
    console.error("SUPABASE CONFIGURATION ERROR");
    console.error("=================================");
    console.error(
        "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
    );
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
   Serve frontend files ONLY from /public.
   (Previously this served __dirname, which
   exposed server.js, .env, package.json and
   node_modules over HTTP — a security bug.)
*/
const PUBLIC_DIR = path.join(__dirname, "public");
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

            const data = await getById(
                table,
                req.params.id
            );

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

            const payload = {
                ...req.body
            };

            /*
               Remove fields that should be
               generated/managed by database
            */

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

            const payload = {
                ...req.body
            };

            /*
               Never allow frontend to change
               primary key or creation date
            */

            delete payload.id;
            delete payload.created_at;

            /*
               Update timestamp automatically
            */

            payload.updated_at =
                new Date().toISOString();

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

            console.error(
                `PUT /api/${table}/${req.params.id}`
            );

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

            console.error(
                `DELETE /api/${table}/${req.params.id}`
            );

            sendError(res, error);
        }
    });
}

/* ================================
   NEXT INVOICE NUMBER
================================ */

app.post("/api/next-invoice", async (req, res) => {
    try {

        const { data, error } = await supabase
            .rpc("next_invoice_no");

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

        if (
            !sale.items ||
            !Array.isArray(sale.items) ||
            sale.items.length === 0
        ) {
            return res.status(400).json({
                status: false,
                message: "Sale must contain at least one item"
            });
        }

        const { data, error } = await supabase
            .rpc("complete_sale", {
                sale_payload: sale
            });

        if (error) {
            throw error;
        }

        res.status(201).json({
            status: true,
            message: "Sale completed successfully",
            data: data
        });

    } catch (error) {

        console.error("COMPLETE SALE ERROR");

        sendError(res, error);
    }
});

/* ================================
   CLIENT PAYMENT / KHATA
================================ */

app.post(
    "/api/clients/:id/payment",
    async (req, res) => {

        try {

            const clientId = req.params.id;

            const amount = Number(
                req.body.amount
            );

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return res.status(400).json({
                    status: false,
                    message: "Invalid payment amount"
                });
            }

            const { data, error } =
                await supabase.rpc(
                    "record_khata_payment",
                    {
                        p_client_id: clientId,
                        p_amount: amount
                    }
                );

            if (error) {
                throw error;
            }

            res.json({
                status: true,
                message: "Payment recorded successfully",
                data: data
            });

        } catch (error) {

            console.error(
                "CLIENT PAYMENT ERROR"
            );

            sendError(res, error);
        }
    }
);

/* ================================
   CLIENT KHATA DETAILS
================================ */

app.get(
    "/api/clients/:id/khata",
    async (req, res) => {

        try {

            const client = await getById(
                "clients",
                req.params.id
            );

            const credit =
                Number(client.lifetime_credit || 0);

            const paid =
                Number(client.lifetime_paid || 0);

            const balance = credit - paid;

            res.json({
                status: true,
                data: {
                    client: client,
                    lifetimeCredit: credit,
                    lifetimePaid: paid,
                    balance: balance
                }
            });

        } catch (error) {

            sendError(res, error, 404);
        }
    }
);

/* ================================
   LOW STOCK PRODUCTS
================================ */

app.get(
    "/api/products/low-stock",
    async (req, res) => {

        try {

            /*
               NOTE: PostgREST's .filter() compares a
               column to a literal VALUE, not to another
               column — ".filter('stock','lte','low_stock')"
               was comparing stock to the literal string
               "low_stock", which is broken. Column-to-column
               comparisons aren't expressible via the query
               builder, so we fetch and compare in Node.
            */
            const { data, error } =
                await supabase
                    .from("products")
                    .select("*")
                    .order("stock", {
                        ascending: true
                    });

            if (error) {
                throw error;
            }

            const lowStock = (data || []).filter(
                product =>
                    Number(product.stock) <=
                    Number(product.low_stock ?? 5)
            );

            res.json({
                status: true,
                data: lowStock
            });

        } catch (error) {

            sendError(res, error, 500);
        }
    }
);

/* ================================
   DASHBOARD STATISTICS
================================ */

app.get(
    "/api/dashboard/stats",
    async (req, res) => {

        try {

            const [
                productsResult,
                sellersResult,
                clientsResult,
                salesResult
            ] = await Promise.all([

                supabase
                    .from("products")
                    .select(
                        "id, stock, price, cost",
                        {
                            count: "exact"
                        }
                    ),

                supabase
                    .from("sellers")
                    .select("id", {
                        count: "exact"
                    }),

                supabase
                    .from("clients")
                    .select(
                        "id, lifetime_credit, lifetime_paid",
                        {
                            count: "exact"
                        }
                    ),

                supabase
                    .from("sales")
                    .select(
                        "id, total, due, amount_paid",
                        {
                            count: "exact"
                        }
                    )
            ]);

            if (productsResult.error)
                throw productsResult.error;

            if (sellersResult.error)
                throw sellersResult.error;

            if (clientsResult.error)
                throw clientsResult.error;

            if (salesResult.error)
                throw salesResult.error;

            const products =
                productsResult.data || [];

            const sellers =
                sellersResult.data || [];

            const clients =
                clientsResult.data || [];

            const sales =
                salesResult.data || [];

            const totalProducts =
                products.length;

            const totalSellers =
                sellers.length;

            const totalClients =
                clients.length;

            const totalSales =
                sales.length;

            const totalRevenue =
                sales.reduce(
                    (sum, sale) =>
                        sum + Number(sale.total || 0),
                    0
                );

            const totalDue =
                sales.reduce(
                    (sum, sale) =>
                        sum + Number(sale.due || 0),
                    0
                );

            const totalPaid =
                sales.reduce(
                    (sum, sale) =>
                        sum + Number(
                            sale.amount_paid || 0
                        ),
                    0
                );

            const lowStock =
                products.filter(
                    product =>
                        Number(product.stock) <=
                        Number(product.low_stock || 5)
                ).length;

            res.json({
                status: true,
                data: {
                    totalProducts,
                    totalSellers,
                    totalClients,
                    totalSales,
                    totalRevenue,
                    totalPaid,
                    totalDue,
                    lowStock
                }
            });

        } catch (error) {

            console.error(
                "DASHBOARD STATS ERROR"
            );

            sendError(res, error, 500);
        }
    }
);

/* ================================
   API 404
================================ */

app.use((req, res, next) => {

    if (req.path.startsWith("/api/")) {

        return res.status(404).json({
            status: false,
            message: "API route not found"
        });
    }

    next();
});

/* ================================
   FRONTEND
================================ */

/*
   If user opens:
   http://localhost:3000

   serve index.html
*/

app.use((req, res) => {

    res.sendFile(
        path.join(
            PUBLIC_DIR,
            "index.html"
        )
    );

});

/* ================================
   GLOBAL ERROR HANDLER
================================ */

app.use(
    (error, req, res, next) => {

        console.error(
            "GLOBAL SERVER ERROR:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            status: false,
            message: "Internal server error"
        });
    }
);

/* ================================
   START SERVER
================================ */

app.listen(PORT, () => {

    console.log("");
    console.log(
        "=========================================="
    );
    console.log(
        "       BAQAL DASHBOARD SERVER"
    );
    console.log(
        "=========================================="
    );
    console.log(
        `Server  : http://localhost:${PORT}`
    );
    console.log(
        `Health  : http://localhost:${PORT}/api/health`
    );
    console.log(
        "Database: Supabase"
    );
    console.log(
        "Status  : Running"
    );
    console.log(
        "=========================================="
    );
    console.log("");

});