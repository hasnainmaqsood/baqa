-- =====================================================
-- Baqal Dashboard — Supabase schema
-- Run this once in your Supabase project's SQL Editor.
-- (This file was missing from the original project archive,
-- so the backend had no tables/functions to talk to.)
-- =====================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------
create table if not exists products (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    category    text default '',
    cost        numeric(12,2) not null default 0,
    price       numeric(12,2) not null default 0,
    stock       integer not null default 0,
    low_stock   integer not null default 5,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------
-- SELLERS
-- ---------------------------------------------------
create table if not exists sellers (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    phone       text default '',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------
-- CLIENTS
-- ---------------------------------------------------
create table if not exists clients (
    id               uuid primary key default gen_random_uuid(),
    name             text not null,
    phone            text default '',
    lifetime_credit  numeric(12,2) not null default 0,
    lifetime_paid    numeric(12,2) not null default 0,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------
-- SALES
-- ---------------------------------------------------
create table if not exists sales (
    id            uuid primary key default gen_random_uuid(),
    invoice_no    integer,
    date          timestamptz not null default now(),
    items         jsonb not null default '[]'::jsonb,
    subtotal      numeric(12,2) not null default 0,
    discount      numeric(12,2) not null default 0,
    total         numeric(12,2) not null default 0,
    amount_paid   numeric(12,2) not null default 0,
    due           numeric(12,2) not null default 0,
    client_id     uuid references clients(id) on delete set null,
    client_name   text default 'Walk-in',
    client_phone  text default '',
    seller_id     uuid references sellers(id) on delete set null,
    seller_name   text default 'Unassigned',
    created_at    timestamptz not null default now()
);

create index if not exists sales_created_at_idx on sales (created_at desc);
create index if not exists sales_client_id_idx on sales (client_id);
create index if not exists sales_seller_id_idx on sales (seller_id);

-- ---------------------------------------------------
-- INVOICE NUMBER SEQUENCE
-- ---------------------------------------------------
create sequence if not exists invoice_no_seq start with 1001;

create or replace function next_invoice_no()
returns integer
language sql
as $$
    select nextval('invoice_no_seq')::integer;
$$;

-- ---------------------------------------------------
-- COMPLETE SALE
-- Inserts the sale, decrements stock for each item sold,
-- and (for credit sales) increases the client's lifetime_credit.
-- Frontend sends camelCase keys inside the jsonb payload;
-- the row it returns uses the table's real (snake_case) columns,
-- which app.js already reads via `sale.field_name || sale.fieldName`.
-- ---------------------------------------------------
create or replace function complete_sale(sale_payload jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
    new_sale     sales;
    cart_item    jsonb;
    v_client_id  uuid;
    v_seller_id  uuid;
    v_due        numeric(12,2);
begin
    v_client_id := nullif(sale_payload->>'clientId', '')::uuid;
    v_seller_id := nullif(sale_payload->>'sellerId', '')::uuid;
    v_due       := coalesce((sale_payload->>'due')::numeric, 0);

    insert into sales (
        invoice_no, date, items, subtotal, discount, total,
        amount_paid, due, client_id, client_name, client_phone,
        seller_id, seller_name
    )
    values (
        nullif(sale_payload->>'invoiceNo', '')::integer,
        coalesce((sale_payload->>'date')::timestamptz, now()),
        coalesce(sale_payload->'items', '[]'::jsonb),
        coalesce((sale_payload->>'subtotal')::numeric, 0),
        coalesce((sale_payload->>'discount')::numeric, 0),
        coalesce((sale_payload->>'total')::numeric, 0),
        coalesce((sale_payload->>'amountPaid')::numeric, 0),
        v_due,
        v_client_id,
        coalesce(sale_payload->>'clientName', 'Walk-in'),
        coalesce(sale_payload->>'clientPhone', ''),
        v_seller_id,
        coalesce(sale_payload->>'sellerName', 'Unassigned')
    )
    returning * into new_sale;

    -- decrement stock for every item in the cart
    for cart_item in
        select * from jsonb_array_elements(coalesce(sale_payload->'items', '[]'::jsonb))
    loop
        update products
        set stock = greatest(0, stock - coalesce((cart_item->>'qty')::integer, 0)),
            updated_at = now()
        where id = nullif(cart_item->>'productId', '')::uuid;
    end loop;

    -- credit sale: add the unpaid amount to the client's running khata
    if v_client_id is not null and v_due > 0 then
        update clients
        set lifetime_credit = lifetime_credit + v_due,
            updated_at = now()
        where id = v_client_id;
    end if;

    return to_jsonb(new_sale);
end;
$$;

-- ---------------------------------------------------
-- RECORD KHATA PAYMENT
-- ---------------------------------------------------
create or replace function record_khata_payment(p_client_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
as $$
declare
    updated_client clients;
begin
    if p_amount is null or p_amount <= 0 then
        raise exception 'Payment amount must be greater than zero';
    end if;

    update clients
    set lifetime_paid = lifetime_paid + p_amount,
        updated_at = now()
    where id = p_client_id
    returning * into updated_client;

    if not found then
        raise exception 'Client not found';
    end if;

    return to_jsonb(updated_client);
end;
$$;

-- ---------------------------------------------------
-- ROW LEVEL SECURITY
-- The Node backend talks to Supabase with the service-role
-- key, which always bypasses RLS — so enabling RLS here with
-- no public policies simply blocks any direct anon/authenticated
-- access to these tables, in case the anon key is ever exposed.
-- ---------------------------------------------------
alter table products enable row level security;
alter table sellers  enable row level security;
alter table clients  enable row level security;
alter table sales    enable row level security;
