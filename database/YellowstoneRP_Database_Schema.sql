--
-- PostgreSQL database dump
--

\restrict dNuVu22UrQ4PBcFMLxEEsgdG9y66u04X2P4sPJpJm3q1EJRZqyiMSFTalDMF4jS

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_action_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_action_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    actor_character_id uuid,
    target_character_id uuid,
    command_key text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_character_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_character_state (
    character_id uuid NOT NULL,
    god_mode boolean DEFAULT false NOT NULL,
    invisible boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_panel_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_panel_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_token text NOT NULL,
    character_id uuid,
    platform_uid text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: alcohol_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alcohol_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid,
    item_key text NOT NULL,
    bac_added numeric(5,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_idempotency (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    endpoint text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    actor_character_id uuid,
    target_character_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: black_market_dealers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.black_market_dealers (
    dealer_key text NOT NULL,
    display_name text NOT NULL,
    shop_key text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    radius_metres numeric(8,2) DEFAULT 3 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: breathalyser_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.breathalyser_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    officer_character_id uuid,
    target_character_id uuid,
    bac numeric(5,3) DEFAULT 0 NOT NULL,
    result text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: business_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_id uuid NOT NULL,
    owner_character_id uuid NOT NULL,
    balance_cents bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_accounts_balance_cents_check CHECK ((balance_cents >= 0))
);


--
-- Name: cad_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cad_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_type text NOT NULL,
    subject_character_id uuid,
    created_by uuid,
    title text NOT NULL,
    body text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cad_reports_report_type_check CHECK ((report_type = ANY (ARRAY['incident'::text, 'arrest'::text, 'evidence'::text, 'bolo'::text, 'note'::text])))
);


--
-- Name: cannabis_evidence_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cannabis_evidence_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    officer_character_id uuid,
    plant_id uuid,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cannabis_evidence_logs_action_check CHECK ((action = ANY (ARRAY['gather_evidence'::text, 'destroy'::text])))
);


--
-- Name: cannabis_farm_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cannabis_farm_zones (
    zone_key text NOT NULL,
    server_id text DEFAULT 'main-rp-server-01'::text NOT NULL,
    display_name text NOT NULL,
    min_x numeric(12,3) NOT NULL,
    max_x numeric(12,3) NOT NULL,
    min_y numeric(12,3) NOT NULL,
    max_y numeric(12,3) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: cannabis_plants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cannabis_plants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    owner_character_id uuid,
    plant_key text NOT NULL,
    x numeric(12,3) DEFAULT 0 NOT NULL,
    y numeric(12,3) DEFAULT 0 NOT NULL,
    z numeric(12,3) DEFAULT 0 NOT NULL,
    growth_stage integer DEFAULT 0 NOT NULL,
    planted_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    harvested boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    evidence_collected boolean DEFAULT false NOT NULL,
    destroyed_by uuid,
    destroyed_at timestamp with time zone
);


--
-- Name: character_clothing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_clothing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    clothing_key text NOT NULL,
    clothing_category text NOT NULL,
    variant text,
    equipped boolean DEFAULT true NOT NULL,
    container_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: character_model_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_model_catalog (
    model_key text NOT NULL,
    display_name text NOT NULL,
    gender text NOT NULL,
    prefab_resource text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT character_model_catalog_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text])))
);


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_id uuid NOT NULL,
    character_code text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date,
    cash_cents bigint DEFAULT 50000 NOT NULL,
    bank_cents bigint DEFAULT 250000 NOT NULL,
    job_key text DEFAULT 'unemployed'::text NOT NULL,
    whitelist_role text DEFAULT 'civilian'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    has_received_welcome_bonus boolean DEFAULT false NOT NULL,
    death_count integer DEFAULT 0 NOT NULL,
    last_spawn_type text DEFAULT 'first_join'::text NOT NULL,
    blood_alcohol_level numeric(5,3) DEFAULT 0 NOT NULL,
    alcohol_updated_at timestamp with time zone DEFAULT now(),
    age integer,
    gender text,
    model_key text,
    CONSTRAINT characters_age_check CHECK (((age >= 16) AND (age <= 100))),
    CONSTRAINT characters_bank_cents_check CHECK ((bank_cents >= 0)),
    CONSTRAINT characters_cash_cents_check CHECK ((cash_cents >= 0)),
    CONSTRAINT characters_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text])))
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    character_id uuid,
    display_name text DEFAULT 'Unknown'::text NOT NULL,
    message text NOT NULL,
    allowed boolean DEFAULT false NOT NULL,
    blocked_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_message_check CHECK ((length(message) <= 300))
);


--
-- Name: clothing_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clothing_catalog (
    clothing_key text NOT NULL,
    display_name text NOT NULL,
    category text NOT NULL,
    price_cents integer DEFAULT 0 NOT NULL,
    variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    has_inventory boolean DEFAULT false NOT NULL,
    slot_cap integer DEFAULT 0 NOT NULL,
    weight_limit_grams integer DEFAULT 0 NOT NULL,
    item_weight_grams integer DEFAULT 500 NOT NULL,
    CONSTRAINT clothing_catalog_item_weight_grams_check CHECK ((item_weight_grams >= 0)),
    CONSTRAINT clothing_catalog_slot_cap_check CHECK (((slot_cap >= 0) AND (slot_cap <= 100))),
    CONSTRAINT clothing_catalog_weight_limit_grams_check CHECK ((weight_limit_grams >= 0))
);


--
-- Name: court_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.court_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    defendant_character_id uuid NOT NULL,
    issued_by_character_id uuid,
    location_key text DEFAULT 'yellowstone_courthouse'::text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    charges jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    result_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT court_cases_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'attended'::text, 'missed'::text, 'cancelled'::text, 'resolved'::text])))
);


--
-- Name: discord_event_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discord_event_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: duty_stations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.duty_stations (
    station_key text NOT NULL,
    display_name text NOT NULL,
    duty_role text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    radius_metres numeric(8,2) DEFAULT 4 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT duty_stations_duty_role_check CHECK ((duty_role = ANY (ARRAY['police'::text, 'fire'::text, 'ems'::text, 'prison'::text])))
);


--
-- Name: fines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    issued_by uuid,
    reason text NOT NULL,
    amount_cents bigint NOT NULL,
    status text DEFAULT 'unpaid'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    CONSTRAINT fines_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT fines_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'void'::text])))
);


--
-- Name: fire_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_key text NOT NULL,
    world_x numeric(12,4) NOT NULL,
    world_y numeric(12,4) NOT NULL,
    world_z numeric(12,4) NOT NULL,
    heat numeric(10,2) DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    extinguished_at timestamp with time zone,
    CONSTRAINT fire_incidents_heat_check CHECK ((heat >= (0)::numeric))
);


--
-- Name: fire_water_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_water_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_key text NOT NULL,
    actor_character_id uuid,
    water_litres numeric(10,2) NOT NULL,
    foam_multiplier numeric(4,2) DEFAULT 1 NOT NULL,
    heat_removed numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gas_station_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gas_station_locations (
    station_key text NOT NULL,
    display_name text NOT NULL,
    price_per_litre_cents bigint DEFAULT 220 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    radius_metres numeric(8,2) DEFAULT 6 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gas_station_locations_price_per_litre_cents_check CHECK ((price_per_litre_cents >= 0))
);


--
-- Name: generated_asset_manifest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_asset_manifest (
    asset_key text NOT NULL,
    asset_type text NOT NULL,
    display_name text NOT NULL,
    source_obj_path text,
    blender_export_name text,
    suggested_prefab_resource text,
    required_component text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hospital_admissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hospital_admissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    admitted_by uuid,
    reason text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    admitted_at timestamp with time zone DEFAULT now() NOT NULL,
    discharged_at timestamp with time zone
);


--
-- Name: injuries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.injuries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    injury_type text NOT NULL,
    injury_kind text DEFAULT 'minor_injury'::text NOT NULL,
    body_part text DEFAULT 'unknown'::text NOT NULL,
    severity integer NOT NULL,
    bleeding_level integer DEFAULT 0 NOT NULL,
    pain_level integer DEFAULT 3 NOT NULL,
    mobility_impact integer DEFAULT 0 NOT NULL,
    consciousness_impact integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    treatment_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    treated boolean DEFAULT false NOT NULL,
    treated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    treated_at timestamp with time zone,
    CONSTRAINT injuries_bleeding_level_check CHECK (((bleeding_level >= 0) AND (bleeding_level <= 5))),
    CONSTRAINT injuries_body_part_check CHECK ((body_part = ANY (ARRAY['head'::text, 'torso'::text, 'left_arm'::text, 'right_arm'::text, 'left_leg'::text, 'right_leg'::text, 'full_body'::text, 'unknown'::text]))),
    CONSTRAINT injuries_consciousness_impact_check CHECK (((consciousness_impact >= 0) AND (consciousness_impact <= 5))),
    CONSTRAINT injuries_injury_kind_check CHECK ((injury_kind = ANY (ARRAY['minor_injury'::text, 'major_injury'::text, 'concussion'::text, 'open_wound'::text, 'broken_bone'::text, 'sprain'::text]))),
    CONSTRAINT injuries_mobility_impact_check CHECK (((mobility_impact >= 0) AND (mobility_impact <= 5))),
    CONSTRAINT injuries_pain_level_check CHECK (((pain_level >= 0) AND (pain_level <= 10))),
    CONSTRAINT injuries_severity_check CHECK (((severity >= 1) AND (severity <= 5)))
);


--
-- Name: interaction_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    actor_character_id uuid,
    target_character_id uuid,
    action_key text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    allowed boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_container_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_container_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    container_id uuid NOT NULL,
    item_key text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_container_items_quantity_check CHECK ((quantity >= 0))
);


--
-- Name: inventory_containers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_containers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid,
    owner_key text,
    character_id uuid,
    vehicle_id uuid,
    clothing_instance_id uuid,
    label text NOT NULL,
    slot_cap integer DEFAULT 20 NOT NULL,
    weight_limit_grams integer DEFAULT 50000 NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_containers_owner_type_check CHECK ((owner_type = ANY (ARRAY['character'::text, 'vehicle_trunk'::text, 'clothing'::text, 'property'::text, 'stash'::text]))),
    CONSTRAINT inventory_containers_slot_cap_check CHECK ((slot_cap >= 0)),
    CONSTRAINT inventory_containers_weight_limit_grams_check CHECK ((weight_limit_grams >= 0))
);


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid,
    item_key text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT inventory_items_quantity_check CHECK ((quantity >= 0))
);


--
-- Name: item_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_catalog (
    item_key text NOT NULL,
    display_name text NOT NULL,
    category text NOT NULL,
    legal_status text DEFAULT 'legal'::text NOT NULL,
    price_cents integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    weight_grams integer DEFAULT 500 NOT NULL,
    stack_limit integer DEFAULT 20 NOT NULL,
    inventory_slot_size integer DEFAULT 1 NOT NULL,
    CONSTRAINT item_catalog_inventory_slot_size_check CHECK ((inventory_slot_size > 0)),
    CONSTRAINT item_catalog_stack_limit_check CHECK ((stack_limit > 0)),
    CONSTRAINT item_catalog_weight_grams_check CHECK ((weight_grams >= 0))
);


--
-- Name: jail_sentences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jail_sentences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    issued_by uuid,
    reason text NOT NULL,
    sentence_seconds integer NOT NULL,
    remaining_seconds integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_tick_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    timer_requires_online boolean DEFAULT true NOT NULL,
    prison_spawn_key text DEFAULT 'spawn_prisoner'::text NOT NULL,
    last_online_tick_at timestamp with time zone,
    CONSTRAINT jail_sentences_remaining_seconds_check CHECK ((remaining_seconds >= 0)),
    CONSTRAINT jail_sentences_sentence_seconds_check CHECK ((sentence_seconds > 0))
);


--
-- Name: jail_tick_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jail_tick_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sentence_id uuid NOT NULL,
    character_id uuid NOT NULL,
    server_id text NOT NULL,
    requested_elapsed_seconds integer DEFAULT 0 NOT NULL,
    applied_elapsed_seconds integer DEFAULT 0 NOT NULL,
    was_online boolean DEFAULT false NOT NULL,
    remaining_seconds integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_definitions (
    job_key text NOT NULL,
    display_name text NOT NULL,
    payout_per_unit_cents bigint NOT NULL,
    max_payout_cents bigint NOT NULL,
    whitelisted boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT job_definitions_max_payout_cents_check CHECK ((max_payout_cents >= 0)),
    CONSTRAINT job_definitions_payout_per_unit_cents_check CHECK ((payout_per_unit_cents >= 0))
);


--
-- Name: job_paycheck_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_paycheck_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    character_id uuid NOT NULL,
    role_key text NOT NULL,
    amount_cents bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_paycheck_claims_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT job_paycheck_claims_role_key_check CHECK ((role_key = ANY (ARRAY['police'::text, 'fire'::text, 'ems'::text, 'prison'::text])))
);


--
-- Name: job_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    job_key text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    payout_cents bigint DEFAULT 0 NOT NULL,
    work_units integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT job_sessions_payout_cents_check CHECK ((payout_cents >= 0)),
    CONSTRAINT job_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: licences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.licences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    licence_type text NOT NULL,
    status text DEFAULT 'valid'::text NOT NULL,
    issued_by uuid,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT licences_licence_type_check CHECK ((licence_type = ANY (ARRAY['driving'::text, 'business'::text, 'firearms'::text, 'taxi'::text, 'mechanic'::text]))),
    CONSTRAINT licences_status_check CHECK ((status = ANY (ARRAY['valid'::text, 'suspended'::text, 'revoked'::text, 'expired'::text])))
);


--
-- Name: online_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.online_players (
    server_id text NOT NULL,
    platform_uid text NOT NULL,
    character_id uuid,
    display_name text NOT NULL,
    role_on_duty text DEFAULT 'civilian'::text NOT NULL,
    is_on_duty boolean DEFAULT false NOT NULL,
    online boolean DEFAULT true NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT online_players_role_on_duty_check CHECK ((role_on_duty = ANY (ARRAY['civilian'::text, 'police'::text, 'fire'::text, 'ems'::text, 'prison'::text, 'admin'::text, 'gm'::text])))
);


--
-- Name: panic_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.panic_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    officer_character_id uuid NOT NULL,
    world_x numeric(12,4) NOT NULL,
    world_y numeric(12,4) NOT NULL,
    world_z numeric(12,4) NOT NULL,
    message text DEFAULT 'Officer panic button activated'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone
);


--
-- Name: phone_twitter_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_twitter_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    character_id uuid,
    handle text,
    message text NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT phone_twitter_posts_handle_check CHECK (((handle IS NULL) OR (handle ~ '^[a-zA-Z0-9_]{2,32}$'::text))),
    CONSTRAINT phone_twitter_posts_message_check CHECK (((length(message) >= 1) AND (length(message) <= 240)))
);


--
-- Name: pit_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pit_states (
    character_id uuid NOT NULL,
    pit_x numeric(12,3) NOT NULL,
    pit_y numeric(12,3) NOT NULL,
    pit_z numeric(12,3) DEFAULT 0 NOT NULL,
    reason text,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform_uid text NOT NULL,
    display_name text NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    is_banned boolean DEFAULT false NOT NULL,
    notes text
);


--
-- Name: police_search_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.police_search_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    officer_character_id uuid,
    target_character_id uuid,
    search_type text DEFAULT 'frisk'::text NOT NULL,
    found_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    found_cash_cents integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prison_cell_doors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prison_cell_doors (
    door_key text NOT NULL,
    display_name text NOT NULL,
    facility_key text DEFAULT 'main_prison'::text NOT NULL,
    locked boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prison_job_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prison_job_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sentence_id uuid NOT NULL,
    character_id uuid NOT NULL,
    job_key text NOT NULL,
    reduction_seconds integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prison_job_logs_reduction_seconds_check CHECK ((reduction_seconds > 0))
);


--
-- Name: project_build_info; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_build_info (
    build_key text NOT NULL,
    build_version text NOT NULL,
    package_name text NOT NULL,
    standalone boolean DEFAULT true NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_key text NOT NULL,
    property_type text NOT NULL,
    display_name text NOT NULL,
    price_cents bigint NOT NULL,
    owner_character_id uuid,
    locked boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT properties_price_cents_check CHECK ((price_cents >= 0)),
    CONSTRAINT properties_property_type_check CHECK ((property_type = ANY (ARRAY['home'::text, 'shop'::text, 'garage'::text, 'warehouse'::text])))
);


--
-- Name: property_door_access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_door_access_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    door_key text NOT NULL,
    actor_character_id uuid,
    access_type text NOT NULL,
    allowed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_door_access_logs_access_type_check CHECK ((access_type = ANY (ARRAY['owner'::text, 'staff'::text, 'code'::text, 'denied'::text])))
);


--
-- Name: property_doors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_doors (
    door_key text NOT NULL,
    property_key text NOT NULL,
    display_name text NOT NULL,
    locked boolean DEFAULT true NOT NULL,
    code_salt text,
    code_hash text,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: radio_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.radio_channels (
    channel_key text NOT NULL,
    display_name text NOT NULL,
    genre text DEFAULT 'mixed'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    tracks jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: radio_play_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.radio_play_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    character_id uuid,
    vehicle_id uuid,
    channel_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: restraint_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restraint_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    actor_character_id uuid,
    target_character_id uuid,
    restraint_type text NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: robberies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robberies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    robbery_key text NOT NULL,
    robbery_type text NOT NULL,
    started_by uuid,
    status text DEFAULT 'active'::text NOT NULL,
    payout_cents bigint DEFAULT 0 NOT NULL,
    min_police_required integer DEFAULT 2 NOT NULL,
    police_online_at_start integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT robberies_payout_cents_check CHECK ((payout_cents >= 0)),
    CONSTRAINT robberies_robbery_type_check CHECK ((robbery_type = ANY (ARRAY['bank'::text, 'store'::text]))),
    CONSTRAINT robberies_status_check CHECK ((status = ANY (ARRAY['active'::text, 'failed'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    role_key text NOT NULL,
    rank_key text DEFAULT 'recruit'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_assignments_role_key_check CHECK ((role_key = ANY (ARRAY['civilian'::text, 'police'::text, 'fire'::text, 'ems'::text, 'prison'::text, 'admin'::text, 'gm'::text])))
);


--
-- Name: scratch_card_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scratch_card_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    cost_cents bigint NOT NULL,
    payout_cents bigint NOT NULL,
    roll numeric(8,6),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: server_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.server_heartbeats (
    server_id text NOT NULL,
    uptime_seconds bigint DEFAULT 0 NOT NULL,
    player_count integer DEFAULT 0 NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: server_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.server_runtime_config (
    config_key text NOT NULL,
    config_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: server_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.server_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shop_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_key text NOT NULL,
    item_key text NOT NULL,
    display_name text NOT NULL,
    price_cents bigint NOT NULL,
    legal boolean DEFAULT true NOT NULL,
    cash_only boolean DEFAULT false NOT NULL,
    requires_licence text,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT shop_items_price_cents_check CHECK ((price_cents >= 0))
);


--
-- Name: slot_machine_plays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_machine_plays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_key text NOT NULL,
    character_id uuid NOT NULL,
    bet_cents integer NOT NULL,
    payout_cents integer DEFAULT 0 NOT NULL,
    outcome_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slot_machine_plays_bet_cents_check CHECK ((bet_cents > 0)),
    CONSTRAINT slot_machine_plays_payout_cents_check CHECK ((payout_cents >= 0))
);


--
-- Name: slot_machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_machines (
    machine_key text NOT NULL,
    building_instance_key text,
    display_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    min_bet_cents integer DEFAULT 100 NOT NULL,
    max_bet_cents integer DEFAULT 5000 NOT NULL,
    payout_profile jsonb DEFAULT '{"bigWinChance": 0.02, "jackpotChance": 0.002, "smallWinChance": 0.18}'::jsonb NOT NULL,
    world_x numeric(12,2),
    world_y numeric(12,2),
    world_z numeric(12,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spawn_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spawn_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    character_id uuid,
    spawn_type text NOT NULL,
    spawn_key text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: speed_radar_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speed_radar_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    officer_character_id uuid,
    target_vehicle_id uuid,
    plate text,
    speed_kph integer NOT NULL,
    limit_kph integer NOT NULL,
    location jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stretcher_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stretcher_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id text NOT NULL,
    ems_character_id uuid,
    patient_character_id uuid,
    ambulance_vehicle_id uuid,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: taxi_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taxi_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_character_id uuid NOT NULL,
    passenger_character_id uuid,
    vehicle_id uuid,
    start_x numeric(12,4),
    start_y numeric(12,4),
    start_z numeric(12,4),
    distance_metres numeric(12,2) DEFAULT 0 NOT NULL,
    fare_cents bigint DEFAULT 250 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sync_at timestamp with time zone,
    ended_at timestamp with time zone
);


--
-- Name: tow_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tow_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tow_truck_vehicle_id uuid,
    target_vehicle_id uuid,
    actor_character_id uuid,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tow_events_event_type_check CHECK ((event_type = ANY (ARRAY['load'::text, 'unload'::text])))
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_character_id uuid,
    to_character_id uuid,
    tx_type text NOT NULL,
    amount_cents bigint NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transactions_amount_cents_check CHECK ((amount_cents >= 0))
);


--
-- Name: uniform_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uniform_catalog (
    uniform_key text NOT NULL,
    role_key text NOT NULL,
    display_name text NOT NULL,
    parts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    character_id uuid NOT NULL,
    granted_by_code boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_asset_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_asset_catalog (
    asset_key text NOT NULL,
    display_name text NOT NULL,
    category text NOT NULL,
    department text,
    prefab_resource text NOT NULL,
    livery_key text,
    price_cents integer DEFAULT 0 NOT NULL,
    is_emergency boolean DEFAULT false NOT NULL,
    is_taxi boolean DEFAULT false NOT NULL,
    is_tow boolean DEFAULT false NOT NULL,
    has_siren boolean DEFAULT false NOT NULL,
    has_emergency_lights boolean DEFAULT false NOT NULL,
    has_rear_storage boolean DEFAULT false NOT NULL,
    has_fire_hose boolean DEFAULT false NOT NULL,
    has_stretcher boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trunk_slot_cap integer DEFAULT 20 NOT NULL,
    trunk_weight_limit_grams integer DEFAULT 100000 NOT NULL,
    trunk_enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT vehicle_asset_catalog_trunk_slot_cap_check CHECK (((trunk_slot_cap >= 0) AND (trunk_slot_cap <= 100))),
    CONSTRAINT vehicle_asset_catalog_trunk_weight_limit_grams_check CHECK ((trunk_weight_limit_grams >= 0))
);


--
-- Name: vehicle_dashboard_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_dashboard_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    actor_character_id uuid,
    action_key text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_repair_stations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_repair_stations (
    station_key text NOT NULL,
    display_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    radius_metres numeric(8,2) DEFAULT 8 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_shop_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_shop_locations (
    shop_key text NOT NULL,
    display_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    radius_metres numeric(8,2) DEFAULT 5 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_shop_spawn_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_shop_spawn_points (
    spawn_key text NOT NULL,
    shop_key text NOT NULL,
    display_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    world_x numeric(12,4) NOT NULL,
    world_y numeric(12,4) NOT NULL,
    world_z numeric(12,4) NOT NULL,
    heading_degrees numeric(8,2) DEFAULT 0 NOT NULL,
    radius_metres numeric(8,2) DEFAULT 6 NOT NULL,
    max_occupied_vehicles integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_shop_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_shop_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_key text NOT NULL,
    stock_key text NOT NULL,
    display_name text NOT NULL,
    prefab_resource text NOT NULL,
    price_cents bigint NOT NULL,
    is_tow_truck boolean DEFAULT false NOT NULL,
    requires_licence text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_taxi boolean DEFAULT false NOT NULL,
    CONSTRAINT vehicle_shop_stock_price_cents_check CHECK ((price_cents >= 0))
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_character_id uuid,
    plate text NOT NULL,
    prefab_resource text NOT NULL,
    display_name text NOT NULL,
    fuel_litres numeric(10,2) DEFAULT 35 NOT NULL,
    max_fuel_litres numeric(10,2) DEFAULT 60 NOT NULL,
    damage_percent numeric(5,2) DEFAULT 0 NOT NULL,
    stored boolean DEFAULT true NOT NULL,
    garage_key text,
    world_x numeric(12,4),
    world_y numeric(12,4),
    world_z numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_tow_truck boolean DEFAULT false NOT NULL,
    loaded_on_vehicle_id uuid,
    loaded_by_character_id uuid,
    loaded_at timestamp with time zone,
    is_taxi boolean DEFAULT false NOT NULL,
    emergency_class text,
    has_siren boolean DEFAULT false NOT NULL,
    has_emergency_lights boolean DEFAULT false NOT NULL,
    has_rear_storage boolean DEFAULT false NOT NULL,
    has_stretcher boolean DEFAULT false NOT NULL,
    has_fire_hose boolean DEFAULT false NOT NULL,
    trunk_slot_cap integer DEFAULT 20 NOT NULL,
    trunk_weight_limit_grams integer DEFAULT 100000 NOT NULL,
    trunk_enabled boolean DEFAULT true NOT NULL,
    registered_owner_character_id uuid,
    locked boolean DEFAULT true NOT NULL,
    vehicle_code_salt text,
    vehicle_code_hash text,
    last_garage_key text,
    purchase_shop_key text,
    purchase_spawn_key text,
    engine_on boolean DEFAULT false NOT NULL,
    headlights_mode text DEFAULT 'off'::text NOT NULL,
    hazards_on boolean DEFAULT false NOT NULL,
    left_indicator_on boolean DEFAULT false NOT NULL,
    right_indicator_on boolean DEFAULT false NOT NULL,
    radio_on boolean DEFAULT false NOT NULL,
    radio_channel_key text DEFAULT 'country_roads'::text,
    dashboard_speed_kph numeric(8,2) DEFAULT 0 NOT NULL,
    dashboard_rpm numeric(8,2) DEFAULT 0 NOT NULL,
    odometer_km numeric(12,2) DEFAULT 0 NOT NULL,
    admin_spawned boolean DEFAULT false NOT NULL,
    claimable boolean DEFAULT false NOT NULL,
    admin_deleted boolean DEFAULT false NOT NULL,
    CONSTRAINT vehicles_damage_percent_check CHECK (((damage_percent >= (0)::numeric) AND (damage_percent <= (100)::numeric))),
    CONSTRAINT vehicles_fuel_litres_check CHECK ((fuel_litres >= (0)::numeric)),
    CONSTRAINT vehicles_headlights_mode_check CHECK ((headlights_mode = ANY (ARRAY['off'::text, 'low'::text, 'high'::text]))),
    CONSTRAINT vehicles_max_fuel_litres_check CHECK ((max_fuel_litres > (0)::numeric)),
    CONSTRAINT vehicles_trunk_slot_cap_check CHECK (((trunk_slot_cap >= 0) AND (trunk_slot_cap <= 100))),
    CONSTRAINT vehicles_trunk_weight_limit_grams_check CHECK ((trunk_weight_limit_grams >= 0))
);


--
-- Name: wanted_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wanted_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    created_by uuid,
    reason text NOT NULL,
    threat_level integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_at timestamp with time zone,
    CONSTRAINT wanted_records_threat_level_check CHECK (((threat_level >= 1) AND (threat_level <= 5)))
);


--
-- Name: weather_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weather_states (
    server_id text NOT NULL,
    weather_key text DEFAULT 'clear'::text NOT NULL,
    intensity numeric(4,2) DEFAULT 0 NOT NULL,
    fog numeric(4,2) DEFAULT 0 NOT NULL,
    wind numeric(5,2) DEFAULT 0 NOT NULL,
    next_change_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_building_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_building_catalog (
    building_key text NOT NULL,
    display_name text NOT NULL,
    building_type text NOT NULL,
    prefab_resource text NOT NULL,
    has_interior boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_building_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_building_instances (
    instance_key text NOT NULL,
    map_key text NOT NULL,
    building_key text NOT NULL,
    display_name text NOT NULL,
    world_x numeric(12,2) NOT NULL,
    world_y numeric(12,2) NOT NULL,
    world_z numeric(12,2) DEFAULT 0 NOT NULL,
    heading_degrees numeric(8,2) DEFAULT 0 NOT NULL,
    accessible boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_maps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_maps (
    id bigint NOT NULL,
    map_key text NOT NULL,
    display_name text NOT NULL,
    size_meters integer DEFAULT 8000 NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_maps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_maps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_maps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_maps_id_seq OWNED BY public.world_maps.id;


--
-- Name: world_placeables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_placeables (
    id bigint NOT NULL,
    map_key text NOT NULL,
    placeable_key text NOT NULL,
    placeable_type text NOT NULL,
    display_name text NOT NULL,
    x numeric(10,2) NOT NULL,
    y numeric(10,2) NOT NULL,
    z numeric(10,2) DEFAULT 0 NOT NULL,
    role text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_placeables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_placeables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_placeables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_placeables_id_seq OWNED BY public.world_placeables.id;


--
-- Name: world_maps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_maps ALTER COLUMN id SET DEFAULT nextval('public.world_maps_id_seq'::regclass);


--
-- Name: world_placeables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_placeables ALTER COLUMN id SET DEFAULT nextval('public.world_placeables_id_seq'::regclass);


--
-- Name: admin_action_logs admin_action_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_logs
    ADD CONSTRAINT admin_action_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_character_state admin_character_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_character_state
    ADD CONSTRAINT admin_character_state_pkey PRIMARY KEY (character_id);


--
-- Name: admin_panel_sessions admin_panel_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_panel_sessions
    ADD CONSTRAINT admin_panel_sessions_pkey PRIMARY KEY (id);


--
-- Name: admin_panel_sessions admin_panel_sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_panel_sessions
    ADD CONSTRAINT admin_panel_sessions_session_token_key UNIQUE (session_token);


--
-- Name: alcohol_events alcohol_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alcohol_events
    ADD CONSTRAINT alcohol_events_pkey PRIMARY KEY (id);


--
-- Name: api_idempotency api_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_idempotency
    ADD CONSTRAINT api_idempotency_pkey PRIMARY KEY (id);


--
-- Name: api_idempotency api_idempotency_server_id_endpoint_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_idempotency
    ADD CONSTRAINT api_idempotency_server_id_endpoint_idempotency_key_key UNIQUE (server_id, endpoint, idempotency_key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: black_market_dealers black_market_dealers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.black_market_dealers
    ADD CONSTRAINT black_market_dealers_pkey PRIMARY KEY (dealer_key);


--
-- Name: breathalyser_logs breathalyser_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.breathalyser_logs
    ADD CONSTRAINT breathalyser_logs_pkey PRIMARY KEY (id);


--
-- Name: business_accounts business_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_pkey PRIMARY KEY (id);


--
-- Name: business_accounts business_accounts_property_id_owner_character_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_property_id_owner_character_id_key UNIQUE (property_id, owner_character_id);


--
-- Name: cad_reports cad_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cad_reports
    ADD CONSTRAINT cad_reports_pkey PRIMARY KEY (id);


--
-- Name: cannabis_evidence_logs cannabis_evidence_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_evidence_logs
    ADD CONSTRAINT cannabis_evidence_logs_pkey PRIMARY KEY (id);


--
-- Name: cannabis_farm_zones cannabis_farm_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_farm_zones
    ADD CONSTRAINT cannabis_farm_zones_pkey PRIMARY KEY (zone_key);


--
-- Name: cannabis_plants cannabis_plants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_plants
    ADD CONSTRAINT cannabis_plants_pkey PRIMARY KEY (id);


--
-- Name: cannabis_plants cannabis_plants_plant_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_plants
    ADD CONSTRAINT cannabis_plants_plant_key_key UNIQUE (plant_key);


--
-- Name: character_clothing character_clothing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_clothing
    ADD CONSTRAINT character_clothing_pkey PRIMARY KEY (id);


--
-- Name: character_model_catalog character_model_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_model_catalog
    ADD CONSTRAINT character_model_catalog_pkey PRIMARY KEY (model_key);


--
-- Name: characters characters_character_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_character_code_key UNIQUE (character_code);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: characters characters_player_id_first_name_last_name_date_of_birth_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_player_id_first_name_last_name_date_of_birth_key UNIQUE (player_id, first_name, last_name, date_of_birth);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: clothing_catalog clothing_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clothing_catalog
    ADD CONSTRAINT clothing_catalog_pkey PRIMARY KEY (clothing_key);


--
-- Name: court_cases court_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_cases
    ADD CONSTRAINT court_cases_pkey PRIMARY KEY (id);


--
-- Name: discord_event_queue discord_event_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discord_event_queue
    ADD CONSTRAINT discord_event_queue_pkey PRIMARY KEY (id);


--
-- Name: duty_stations duty_stations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_stations
    ADD CONSTRAINT duty_stations_pkey PRIMARY KEY (station_key);


--
-- Name: fines fines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_pkey PRIMARY KEY (id);


--
-- Name: fire_incidents fire_incidents_incident_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_incidents
    ADD CONSTRAINT fire_incidents_incident_key_key UNIQUE (incident_key);


--
-- Name: fire_incidents fire_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_incidents
    ADD CONSTRAINT fire_incidents_pkey PRIMARY KEY (id);


--
-- Name: fire_water_logs fire_water_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_water_logs
    ADD CONSTRAINT fire_water_logs_pkey PRIMARY KEY (id);


--
-- Name: gas_station_locations gas_station_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gas_station_locations
    ADD CONSTRAINT gas_station_locations_pkey PRIMARY KEY (station_key);


--
-- Name: generated_asset_manifest generated_asset_manifest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_asset_manifest
    ADD CONSTRAINT generated_asset_manifest_pkey PRIMARY KEY (asset_key);


--
-- Name: hospital_admissions hospital_admissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hospital_admissions
    ADD CONSTRAINT hospital_admissions_pkey PRIMARY KEY (id);


--
-- Name: injuries injuries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.injuries
    ADD CONSTRAINT injuries_pkey PRIMARY KEY (id);


--
-- Name: interaction_audits interaction_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_audits
    ADD CONSTRAINT interaction_audits_pkey PRIMARY KEY (id);


--
-- Name: inventory_container_items inventory_container_items_container_id_item_key_metadata_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_container_items
    ADD CONSTRAINT inventory_container_items_container_id_item_key_metadata_key UNIQUE (container_id, item_key, metadata);


--
-- Name: inventory_container_items inventory_container_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_container_items
    ADD CONSTRAINT inventory_container_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_containers inventory_containers_owner_type_owner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_containers
    ADD CONSTRAINT inventory_containers_owner_type_owner_id_key UNIQUE (owner_type, owner_id);


--
-- Name: inventory_containers inventory_containers_owner_type_owner_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_containers
    ADD CONSTRAINT inventory_containers_owner_type_owner_key_key UNIQUE (owner_type, owner_key);


--
-- Name: inventory_containers inventory_containers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_containers
    ADD CONSTRAINT inventory_containers_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_character_id_item_key_metadata_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_character_id_item_key_metadata_key UNIQUE (character_id, item_key, metadata);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: item_catalog item_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_catalog
    ADD CONSTRAINT item_catalog_pkey PRIMARY KEY (item_key);


--
-- Name: jail_sentences jail_sentences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jail_sentences
    ADD CONSTRAINT jail_sentences_pkey PRIMARY KEY (id);


--
-- Name: jail_tick_logs jail_tick_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jail_tick_logs
    ADD CONSTRAINT jail_tick_logs_pkey PRIMARY KEY (id);


--
-- Name: job_definitions job_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_definitions
    ADD CONSTRAINT job_definitions_pkey PRIMARY KEY (job_key);


--
-- Name: job_paycheck_claims job_paycheck_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_paycheck_claims
    ADD CONSTRAINT job_paycheck_claims_pkey PRIMARY KEY (id);


--
-- Name: job_sessions job_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sessions
    ADD CONSTRAINT job_sessions_pkey PRIMARY KEY (id);


--
-- Name: licences licences_character_id_licence_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licences
    ADD CONSTRAINT licences_character_id_licence_type_key UNIQUE (character_id, licence_type);


--
-- Name: licences licences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licences
    ADD CONSTRAINT licences_pkey PRIMARY KEY (id);


--
-- Name: online_players online_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_players
    ADD CONSTRAINT online_players_pkey PRIMARY KEY (server_id, platform_uid);


--
-- Name: panic_alerts panic_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.panic_alerts
    ADD CONSTRAINT panic_alerts_pkey PRIMARY KEY (id);


--
-- Name: phone_twitter_posts phone_twitter_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_twitter_posts
    ADD CONSTRAINT phone_twitter_posts_pkey PRIMARY KEY (id);


--
-- Name: pit_states pit_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pit_states
    ADD CONSTRAINT pit_states_pkey PRIMARY KEY (character_id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: players players_platform_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_platform_uid_key UNIQUE (platform_uid);


--
-- Name: police_search_logs police_search_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.police_search_logs
    ADD CONSTRAINT police_search_logs_pkey PRIMARY KEY (id);


--
-- Name: prison_cell_doors prison_cell_doors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prison_cell_doors
    ADD CONSTRAINT prison_cell_doors_pkey PRIMARY KEY (door_key);


--
-- Name: prison_job_logs prison_job_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prison_job_logs
    ADD CONSTRAINT prison_job_logs_pkey PRIMARY KEY (id);


--
-- Name: project_build_info project_build_info_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_build_info
    ADD CONSTRAINT project_build_info_pkey PRIMARY KEY (build_key);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: properties properties_property_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_property_key_key UNIQUE (property_key);


--
-- Name: property_door_access_logs property_door_access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_door_access_logs
    ADD CONSTRAINT property_door_access_logs_pkey PRIMARY KEY (id);


--
-- Name: property_doors property_doors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_doors
    ADD CONSTRAINT property_doors_pkey PRIMARY KEY (door_key);


--
-- Name: radio_channels radio_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_channels
    ADD CONSTRAINT radio_channels_pkey PRIMARY KEY (channel_key);


--
-- Name: radio_play_logs radio_play_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_play_logs
    ADD CONSTRAINT radio_play_logs_pkey PRIMARY KEY (id);


--
-- Name: restraint_logs restraint_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restraint_logs
    ADD CONSTRAINT restraint_logs_pkey PRIMARY KEY (id);


--
-- Name: robberies robberies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robberies
    ADD CONSTRAINT robberies_pkey PRIMARY KEY (id);


--
-- Name: role_assignments role_assignments_character_id_role_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_character_id_role_key_key UNIQUE (character_id, role_key);


--
-- Name: role_assignments role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_pkey PRIMARY KEY (id);


--
-- Name: scratch_card_logs scratch_card_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scratch_card_logs
    ADD CONSTRAINT scratch_card_logs_pkey PRIMARY KEY (id);


--
-- Name: server_heartbeats server_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_heartbeats
    ADD CONSTRAINT server_heartbeats_pkey PRIMARY KEY (server_id);


--
-- Name: server_runtime_config server_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_runtime_config
    ADD CONSTRAINT server_runtime_config_pkey PRIMARY KEY (config_key);


--
-- Name: server_settings server_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_settings
    ADD CONSTRAINT server_settings_pkey PRIMARY KEY (key);


--
-- Name: shop_items shop_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_items
    ADD CONSTRAINT shop_items_pkey PRIMARY KEY (id);


--
-- Name: shop_items shop_items_shop_key_item_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_items
    ADD CONSTRAINT shop_items_shop_key_item_key_key UNIQUE (shop_key, item_key);


--
-- Name: slot_machine_plays slot_machine_plays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_machine_plays
    ADD CONSTRAINT slot_machine_plays_pkey PRIMARY KEY (id);


--
-- Name: slot_machines slot_machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_machines
    ADD CONSTRAINT slot_machines_pkey PRIMARY KEY (machine_key);


--
-- Name: spawn_logs spawn_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_logs
    ADD CONSTRAINT spawn_logs_pkey PRIMARY KEY (id);


--
-- Name: speed_radar_logs speed_radar_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speed_radar_logs
    ADD CONSTRAINT speed_radar_logs_pkey PRIMARY KEY (id);


--
-- Name: stretcher_events stretcher_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stretcher_events
    ADD CONSTRAINT stretcher_events_pkey PRIMARY KEY (id);


--
-- Name: taxi_sessions taxi_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxi_sessions
    ADD CONSTRAINT taxi_sessions_pkey PRIMARY KEY (id);


--
-- Name: tow_events tow_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tow_events
    ADD CONSTRAINT tow_events_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: uniform_catalog uniform_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uniform_catalog
    ADD CONSTRAINT uniform_catalog_pkey PRIMARY KEY (uniform_key);


--
-- Name: vehicle_access_grants vehicle_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_access_grants
    ADD CONSTRAINT vehicle_access_grants_pkey PRIMARY KEY (id);


--
-- Name: vehicle_access_grants vehicle_access_grants_vehicle_id_character_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_access_grants
    ADD CONSTRAINT vehicle_access_grants_vehicle_id_character_id_key UNIQUE (vehicle_id, character_id);


--
-- Name: vehicle_asset_catalog vehicle_asset_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_asset_catalog
    ADD CONSTRAINT vehicle_asset_catalog_pkey PRIMARY KEY (asset_key);


--
-- Name: vehicle_dashboard_events vehicle_dashboard_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_dashboard_events
    ADD CONSTRAINT vehicle_dashboard_events_pkey PRIMARY KEY (id);


--
-- Name: vehicle_repair_stations vehicle_repair_stations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_repair_stations
    ADD CONSTRAINT vehicle_repair_stations_pkey PRIMARY KEY (station_key);


--
-- Name: vehicle_shop_locations vehicle_shop_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_shop_locations
    ADD CONSTRAINT vehicle_shop_locations_pkey PRIMARY KEY (shop_key);


--
-- Name: vehicle_shop_spawn_points vehicle_shop_spawn_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_shop_spawn_points
    ADD CONSTRAINT vehicle_shop_spawn_points_pkey PRIMARY KEY (spawn_key);


--
-- Name: vehicle_shop_stock vehicle_shop_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_shop_stock
    ADD CONSTRAINT vehicle_shop_stock_pkey PRIMARY KEY (id);


--
-- Name: vehicle_shop_stock vehicle_shop_stock_shop_key_stock_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_shop_stock
    ADD CONSTRAINT vehicle_shop_stock_shop_key_stock_key_key UNIQUE (shop_key, stock_key);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_plate_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_plate_key UNIQUE (plate);


--
-- Name: wanted_records wanted_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wanted_records
    ADD CONSTRAINT wanted_records_pkey PRIMARY KEY (id);


--
-- Name: weather_states weather_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_states
    ADD CONSTRAINT weather_states_pkey PRIMARY KEY (server_id);


--
-- Name: world_building_catalog world_building_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_building_catalog
    ADD CONSTRAINT world_building_catalog_pkey PRIMARY KEY (building_key);


--
-- Name: world_building_instances world_building_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_building_instances
    ADD CONSTRAINT world_building_instances_pkey PRIMARY KEY (instance_key);


--
-- Name: world_maps world_maps_map_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_maps
    ADD CONSTRAINT world_maps_map_key_key UNIQUE (map_key);


--
-- Name: world_maps world_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_maps
    ADD CONSTRAINT world_maps_pkey PRIMARY KEY (id);


--
-- Name: world_placeables world_placeables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_placeables
    ADD CONSTRAINT world_placeables_pkey PRIMARY KEY (id);


--
-- Name: world_placeables world_placeables_placeable_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_placeables
    ADD CONSTRAINT world_placeables_placeable_key_key UNIQUE (placeable_key);


--
-- Name: idx_audit_action_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_action_time ON public.audit_logs USING btree (action, created_at);


--
-- Name: idx_black_market_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_black_market_active ON public.black_market_dealers USING btree (active);


--
-- Name: idx_character_clothing_character; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_character_clothing_character ON public.character_clothing USING btree (character_id, equipped);


--
-- Name: idx_characters_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_name ON public.characters USING btree (first_name, last_name);


--
-- Name: idx_characters_unique_full_name_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_characters_unique_full_name_ci ON public.characters USING btree (lower(first_name), lower(last_name));


--
-- Name: idx_chat_messages_server_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_server_time ON public.chat_messages USING btree (server_id, created_at DESC);


--
-- Name: idx_duty_stations_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_duty_stations_role ON public.duty_stations USING btree (duty_role, active);


--
-- Name: idx_fire_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fire_active ON public.fire_incidents USING btree (active);


--
-- Name: idx_gas_station_locations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gas_station_locations_active ON public.gas_station_locations USING btree (active);


--
-- Name: idx_injuries_character_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_injuries_character_active ON public.injuries USING btree (character_id, active, treated);


--
-- Name: idx_interaction_audits_action_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_audits_action_time ON public.interaction_audits USING btree (action_key, created_at DESC);


--
-- Name: idx_interaction_audits_actor_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_audits_actor_time ON public.interaction_audits USING btree (actor_character_id, created_at DESC);


--
-- Name: idx_inventory_container_items_container; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_container_items_container ON public.inventory_container_items USING btree (container_id);


--
-- Name: idx_inventory_containers_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_containers_owner ON public.inventory_containers USING btree (owner_type, owner_id, owner_key);


--
-- Name: idx_jail_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jail_active ON public.jail_sentences USING btree (character_id, active);


--
-- Name: idx_jail_tick_logs_character; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jail_tick_logs_character ON public.jail_tick_logs USING btree (character_id, created_at DESC);


--
-- Name: idx_online_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_online_role ON public.online_players USING btree (role_on_duty, is_on_duty, online, last_seen);


--
-- Name: idx_panic_alerts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_panic_alerts_active ON public.panic_alerts USING btree (server_id, active, created_at DESC);


--
-- Name: idx_paycheck_claims_character_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_paycheck_claims_character_role ON public.job_paycheck_claims USING btree (character_id, role_key, created_at DESC);


--
-- Name: idx_phone_twitter_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_twitter_feed ON public.phone_twitter_posts USING btree (server_id, deleted, created_at DESC);


--
-- Name: idx_prison_cell_doors_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prison_cell_doors_active ON public.prison_cell_doors USING btree (active);


--
-- Name: idx_property_doors_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_doors_property ON public.property_doors USING btree (property_key, active);


--
-- Name: idx_repair_stations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_stations_active ON public.vehicle_repair_stations USING btree (active);


--
-- Name: idx_slot_plays_character; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slot_plays_character ON public.slot_machine_plays USING btree (character_id, created_at DESC);


--
-- Name: idx_transactions_char_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_char_time ON public.transactions USING btree (from_character_id, to_character_id, created_at);


--
-- Name: idx_vehicle_loaded_on; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_loaded_on ON public.vehicles USING btree (loaded_on_vehicle_id);


--
-- Name: idx_vehicle_shop_spawn_points_shop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_shop_spawn_points_shop ON public.vehicle_shop_spawn_points USING btree (shop_key, active);


--
-- Name: idx_vehicle_shops_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_shops_active ON public.vehicle_shop_locations USING btree (active);


--
-- Name: idx_vehicles_garage_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_garage_owner ON public.vehicles USING btree (owner_character_id, garage_key, stored);


--
-- Name: idx_vehicles_is_taxi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_is_taxi ON public.vehicles USING btree (is_taxi);


--
-- Name: idx_vehicles_plate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_plate ON public.vehicles USING btree (plate);


--
-- Name: idx_vehicles_registered_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_registered_owner ON public.vehicles USING btree (registered_owner_character_id);


--
-- Name: idx_wanted_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wanted_active ON public.wanted_records USING btree (character_id, active);


--
-- Name: idx_world_buildings_map; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_buildings_map ON public.world_building_instances USING btree (map_key, building_key);


--
-- Name: admin_action_logs admin_action_logs_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_logs
    ADD CONSTRAINT admin_action_logs_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: admin_action_logs admin_action_logs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_logs
    ADD CONSTRAINT admin_action_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.admin_panel_sessions(id) ON DELETE SET NULL;


--
-- Name: admin_action_logs admin_action_logs_target_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_logs
    ADD CONSTRAINT admin_action_logs_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: admin_character_state admin_character_state_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_character_state
    ADD CONSTRAINT admin_character_state_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: admin_panel_sessions admin_panel_sessions_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_panel_sessions
    ADD CONSTRAINT admin_panel_sessions_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: alcohol_events alcohol_events_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alcohol_events
    ADD CONSTRAINT alcohol_events_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: audit_logs audit_logs_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_target_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: breathalyser_logs breathalyser_logs_officer_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.breathalyser_logs
    ADD CONSTRAINT breathalyser_logs_officer_character_id_fkey FOREIGN KEY (officer_character_id) REFERENCES public.characters(id);


--
-- Name: breathalyser_logs breathalyser_logs_target_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.breathalyser_logs
    ADD CONSTRAINT breathalyser_logs_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id);


--
-- Name: business_accounts business_accounts_owner_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_owner_character_id_fkey FOREIGN KEY (owner_character_id) REFERENCES public.characters(id);


--
-- Name: business_accounts business_accounts_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: cad_reports cad_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cad_reports
    ADD CONSTRAINT cad_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.characters(id);


--
-- Name: cad_reports cad_reports_subject_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cad_reports
    ADD CONSTRAINT cad_reports_subject_character_id_fkey FOREIGN KEY (subject_character_id) REFERENCES public.characters(id);


--
-- Name: cannabis_evidence_logs cannabis_evidence_logs_officer_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_evidence_logs
    ADD CONSTRAINT cannabis_evidence_logs_officer_character_id_fkey FOREIGN KEY (officer_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: cannabis_evidence_logs cannabis_evidence_logs_plant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_evidence_logs
    ADD CONSTRAINT cannabis_evidence_logs_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.cannabis_plants(id) ON DELETE SET NULL;


--
-- Name: cannabis_plants cannabis_plants_destroyed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_plants
    ADD CONSTRAINT cannabis_plants_destroyed_by_fkey FOREIGN KEY (destroyed_by) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: cannabis_plants cannabis_plants_owner_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cannabis_plants
    ADD CONSTRAINT cannabis_plants_owner_character_id_fkey FOREIGN KEY (owner_character_id) REFERENCES public.characters(id);


--
-- Name: character_clothing character_clothing_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_clothing
    ADD CONSTRAINT character_clothing_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: character_clothing character_clothing_clothing_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_clothing
    ADD CONSTRAINT character_clothing_clothing_key_fkey FOREIGN KEY (clothing_key) REFERENCES public.clothing_catalog(clothing_key);


--
-- Name: character_clothing character_clothing_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_clothing
    ADD CONSTRAINT character_clothing_container_id_fkey FOREIGN KEY (container_id) REFERENCES public.inventory_containers(id) ON DELETE SET NULL;


--
-- Name: characters characters_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: court_cases court_cases_defendant_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_cases
    ADD CONSTRAINT court_cases_defendant_character_id_fkey FOREIGN KEY (defendant_character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: court_cases court_cases_issued_by_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_cases
    ADD CONSTRAINT court_cases_issued_by_character_id_fkey FOREIGN KEY (issued_by_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: fines fines_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: fines fines_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.characters(id);


--
-- Name: fire_water_logs fire_water_logs_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_water_logs
    ADD CONSTRAINT fire_water_logs_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id);


--
-- Name: inventory_containers fk_inventory_clothing_instance; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_containers
    ADD CONSTRAINT fk_inventory_clothing_instance FOREIGN KEY (clothing_instance_id) REFERENCES public.character_clothing(id) ON DELETE CASCADE NOT VALID;


--
-- Name: hospital_admissions hospital_admissions_admitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hospital_admissions
    ADD CONSTRAINT hospital_admissions_admitted_by_fkey FOREIGN KEY (admitted_by) REFERENCES public.characters(id);


--
-- Name: hospital_admissions hospital_admissions_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hospital_admissions
    ADD CONSTRAINT hospital_admissions_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: injuries injuries_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.injuries
    ADD CONSTRAINT injuries_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: injuries injuries_treated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.injuries
    ADD CONSTRAINT injuries_treated_by_fkey FOREIGN KEY (treated_by) REFERENCES public.characters(id);


--
-- Name: interaction_audits interaction_audits_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_audits
    ADD CONSTRAINT interaction_audits_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: interaction_audits interaction_audits_target_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_audits
    ADD CONSTRAINT interaction_audits_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: inventory_container_items inventory_container_items_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_container_items
    ADD CONSTRAINT inventory_container_items_container_id_fkey FOREIGN KEY (container_id) REFERENCES public.inventory_containers(id) ON DELETE CASCADE;


--
-- Name: inventory_containers inventory_containers_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_containers
    ADD CONSTRAINT inventory_containers_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: inventory_containers inventory_containers_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_containers
    ADD CONSTRAINT inventory_containers_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: inventory_items inventory_items_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: jail_sentences jail_sentences_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jail_sentences
    ADD CONSTRAINT jail_sentences_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: jail_sentences jail_sentences_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jail_sentences
    ADD CONSTRAINT jail_sentences_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.characters(id);


--
-- Name: jail_tick_logs jail_tick_logs_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jail_tick_logs
    ADD CONSTRAINT jail_tick_logs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: jail_tick_logs jail_tick_logs_sentence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jail_tick_logs
    ADD CONSTRAINT jail_tick_logs_sentence_id_fkey FOREIGN KEY (sentence_id) REFERENCES public.jail_sentences(id) ON DELETE CASCADE;


--
-- Name: job_paycheck_claims job_paycheck_claims_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_paycheck_claims
    ADD CONSTRAINT job_paycheck_claims_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: job_sessions job_sessions_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sessions
    ADD CONSTRAINT job_sessions_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: licences licences_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licences
    ADD CONSTRAINT licences_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: licences licences_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licences
    ADD CONSTRAINT licences_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.characters(id);


--
-- Name: online_players online_players_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_players
    ADD CONSTRAINT online_players_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: panic_alerts panic_alerts_officer_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.panic_alerts
    ADD CONSTRAINT panic_alerts_officer_character_id_fkey FOREIGN KEY (officer_character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: panic_alerts panic_alerts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.panic_alerts
    ADD CONSTRAINT panic_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: phone_twitter_posts phone_twitter_posts_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_twitter_posts
    ADD CONSTRAINT phone_twitter_posts_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: pit_states pit_states_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pit_states
    ADD CONSTRAINT pit_states_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: police_search_logs police_search_logs_officer_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.police_search_logs
    ADD CONSTRAINT police_search_logs_officer_character_id_fkey FOREIGN KEY (officer_character_id) REFERENCES public.characters(id);


--
-- Name: police_search_logs police_search_logs_target_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.police_search_logs
    ADD CONSTRAINT police_search_logs_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id);


--
-- Name: prison_job_logs prison_job_logs_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prison_job_logs
    ADD CONSTRAINT prison_job_logs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: prison_job_logs prison_job_logs_sentence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prison_job_logs
    ADD CONSTRAINT prison_job_logs_sentence_id_fkey FOREIGN KEY (sentence_id) REFERENCES public.jail_sentences(id) ON DELETE CASCADE;


--
-- Name: properties properties_owner_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_owner_character_id_fkey FOREIGN KEY (owner_character_id) REFERENCES public.characters(id);


--
-- Name: property_door_access_logs property_door_access_logs_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_door_access_logs
    ADD CONSTRAINT property_door_access_logs_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: property_door_access_logs property_door_access_logs_door_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_door_access_logs
    ADD CONSTRAINT property_door_access_logs_door_key_fkey FOREIGN KEY (door_key) REFERENCES public.property_doors(door_key) ON DELETE CASCADE;


--
-- Name: property_doors property_doors_property_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_doors
    ADD CONSTRAINT property_doors_property_key_fkey FOREIGN KEY (property_key) REFERENCES public.properties(property_key) ON DELETE CASCADE;


--
-- Name: radio_play_logs radio_play_logs_channel_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_play_logs
    ADD CONSTRAINT radio_play_logs_channel_key_fkey FOREIGN KEY (channel_key) REFERENCES public.radio_channels(channel_key);


--
-- Name: radio_play_logs radio_play_logs_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_play_logs
    ADD CONSTRAINT radio_play_logs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: radio_play_logs radio_play_logs_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_play_logs
    ADD CONSTRAINT radio_play_logs_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: restraint_logs restraint_logs_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restraint_logs
    ADD CONSTRAINT restraint_logs_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id);


--
-- Name: restraint_logs restraint_logs_target_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restraint_logs
    ADD CONSTRAINT restraint_logs_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id);


--
-- Name: robberies robberies_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robberies
    ADD CONSTRAINT robberies_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.characters(id);


--
-- Name: role_assignments role_assignments_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: scratch_card_logs scratch_card_logs_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scratch_card_logs
    ADD CONSTRAINT scratch_card_logs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: slot_machine_plays slot_machine_plays_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_machine_plays
    ADD CONSTRAINT slot_machine_plays_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: slot_machine_plays slot_machine_plays_machine_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_machine_plays
    ADD CONSTRAINT slot_machine_plays_machine_key_fkey FOREIGN KEY (machine_key) REFERENCES public.slot_machines(machine_key);


--
-- Name: slot_machines slot_machines_building_instance_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_machines
    ADD CONSTRAINT slot_machines_building_instance_key_fkey FOREIGN KEY (building_instance_key) REFERENCES public.world_building_instances(instance_key) ON DELETE SET NULL;


--
-- Name: spawn_logs spawn_logs_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_logs
    ADD CONSTRAINT spawn_logs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: speed_radar_logs speed_radar_logs_officer_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speed_radar_logs
    ADD CONSTRAINT speed_radar_logs_officer_character_id_fkey FOREIGN KEY (officer_character_id) REFERENCES public.characters(id);


--
-- Name: speed_radar_logs speed_radar_logs_target_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speed_radar_logs
    ADD CONSTRAINT speed_radar_logs_target_vehicle_id_fkey FOREIGN KEY (target_vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: stretcher_events stretcher_events_ambulance_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stretcher_events
    ADD CONSTRAINT stretcher_events_ambulance_vehicle_id_fkey FOREIGN KEY (ambulance_vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: stretcher_events stretcher_events_ems_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stretcher_events
    ADD CONSTRAINT stretcher_events_ems_character_id_fkey FOREIGN KEY (ems_character_id) REFERENCES public.characters(id);


--
-- Name: stretcher_events stretcher_events_patient_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stretcher_events
    ADD CONSTRAINT stretcher_events_patient_character_id_fkey FOREIGN KEY (patient_character_id) REFERENCES public.characters(id);


--
-- Name: taxi_sessions taxi_sessions_driver_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxi_sessions
    ADD CONSTRAINT taxi_sessions_driver_character_id_fkey FOREIGN KEY (driver_character_id) REFERENCES public.characters(id);


--
-- Name: taxi_sessions taxi_sessions_passenger_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxi_sessions
    ADD CONSTRAINT taxi_sessions_passenger_character_id_fkey FOREIGN KEY (passenger_character_id) REFERENCES public.characters(id);


--
-- Name: taxi_sessions taxi_sessions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxi_sessions
    ADD CONSTRAINT taxi_sessions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: tow_events tow_events_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tow_events
    ADD CONSTRAINT tow_events_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: tow_events tow_events_target_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tow_events
    ADD CONSTRAINT tow_events_target_vehicle_id_fkey FOREIGN KEY (target_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: tow_events tow_events_tow_truck_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tow_events
    ADD CONSTRAINT tow_events_tow_truck_vehicle_id_fkey FOREIGN KEY (tow_truck_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_from_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_from_character_id_fkey FOREIGN KEY (from_character_id) REFERENCES public.characters(id);


--
-- Name: transactions transactions_to_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_to_character_id_fkey FOREIGN KEY (to_character_id) REFERENCES public.characters(id);


--
-- Name: vehicle_access_grants vehicle_access_grants_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_access_grants
    ADD CONSTRAINT vehicle_access_grants_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: vehicle_access_grants vehicle_access_grants_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_access_grants
    ADD CONSTRAINT vehicle_access_grants_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_dashboard_events vehicle_dashboard_events_actor_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_dashboard_events
    ADD CONSTRAINT vehicle_dashboard_events_actor_character_id_fkey FOREIGN KEY (actor_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: vehicle_dashboard_events vehicle_dashboard_events_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_dashboard_events
    ADD CONSTRAINT vehicle_dashboard_events_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_shop_spawn_points vehicle_shop_spawn_points_shop_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_shop_spawn_points
    ADD CONSTRAINT vehicle_shop_spawn_points_shop_key_fkey FOREIGN KEY (shop_key) REFERENCES public.vehicle_shop_locations(shop_key) ON DELETE CASCADE;


--
-- Name: vehicle_shop_stock vehicle_shop_stock_shop_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_shop_stock
    ADD CONSTRAINT vehicle_shop_stock_shop_key_fkey FOREIGN KEY (shop_key) REFERENCES public.vehicle_shop_locations(shop_key) ON DELETE CASCADE;


--
-- Name: vehicles vehicles_loaded_by_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_loaded_by_character_id_fkey FOREIGN KEY (loaded_by_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: vehicles vehicles_loaded_on_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_loaded_on_vehicle_id_fkey FOREIGN KEY (loaded_on_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: vehicles vehicles_owner_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_owner_character_id_fkey FOREIGN KEY (owner_character_id) REFERENCES public.characters(id);


--
-- Name: vehicles vehicles_registered_owner_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_registered_owner_character_id_fkey FOREIGN KEY (registered_owner_character_id) REFERENCES public.characters(id) ON DELETE SET NULL;


--
-- Name: wanted_records wanted_records_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wanted_records
    ADD CONSTRAINT wanted_records_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id);


--
-- Name: wanted_records wanted_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wanted_records
    ADD CONSTRAINT wanted_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.characters(id);


--
-- Name: world_building_instances world_building_instances_building_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_building_instances
    ADD CONSTRAINT world_building_instances_building_key_fkey FOREIGN KEY (building_key) REFERENCES public.world_building_catalog(building_key);


--
-- Name: world_building_instances world_building_instances_map_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_building_instances
    ADD CONSTRAINT world_building_instances_map_key_fkey FOREIGN KEY (map_key) REFERENCES public.world_maps(map_key) ON DELETE CASCADE;


--
-- Name: world_placeables world_placeables_map_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_placeables
    ADD CONSTRAINT world_placeables_map_key_fkey FOREIGN KEY (map_key) REFERENCES public.world_maps(map_key) ON DELETE CASCADE;


--
-- Name: admin_action_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_action_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_character_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_character_state ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_panel_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_panel_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: alcohol_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alcohol_events ENABLE ROW LEVEL SECURITY;

--
-- Name: api_idempotency; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_idempotency ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: black_market_dealers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.black_market_dealers ENABLE ROW LEVEL SECURITY;

--
-- Name: breathalyser_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.breathalyser_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: business_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: cad_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cad_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: cannabis_evidence_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cannabis_evidence_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: cannabis_farm_zones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cannabis_farm_zones ENABLE ROW LEVEL SECURITY;

--
-- Name: cannabis_plants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cannabis_plants ENABLE ROW LEVEL SECURITY;

--
-- Name: character_clothing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.character_clothing ENABLE ROW LEVEL SECURITY;

--
-- Name: character_model_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.character_model_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: characters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: clothing_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clothing_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: court_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: discord_event_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discord_event_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: duty_stations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.duty_stations ENABLE ROW LEVEL SECURITY;

--
-- Name: fines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fines ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_water_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_water_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: gas_station_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gas_station_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_asset_manifest; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_asset_manifest ENABLE ROW LEVEL SECURITY;

--
-- Name: hospital_admissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hospital_admissions ENABLE ROW LEVEL SECURITY;

--
-- Name: injuries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.injuries ENABLE ROW LEVEL SECURITY;

--
-- Name: interaction_audits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interaction_audits ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_container_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_container_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_containers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_containers ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

--
-- Name: item_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: jail_sentences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jail_sentences ENABLE ROW LEVEL SECURITY;

--
-- Name: jail_tick_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jail_tick_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: job_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: job_paycheck_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_paycheck_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: job_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: licences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.licences ENABLE ROW LEVEL SECURITY;

--
-- Name: online_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.online_players ENABLE ROW LEVEL SECURITY;

--
-- Name: panic_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.panic_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_twitter_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_twitter_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: pit_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pit_states ENABLE ROW LEVEL SECURITY;

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

--
-- Name: police_search_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.police_search_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: prison_cell_doors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prison_cell_doors ENABLE ROW LEVEL SECURITY;

--
-- Name: prison_job_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prison_job_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_build_info; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_build_info ENABLE ROW LEVEL SECURITY;

--
-- Name: properties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

--
-- Name: property_door_access_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.property_door_access_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: property_doors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.property_doors ENABLE ROW LEVEL SECURITY;

--
-- Name: radio_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.radio_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: radio_play_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.radio_play_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: restraint_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restraint_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: robberies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.robberies ENABLE ROW LEVEL SECURITY;

--
-- Name: role_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: scratch_card_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scratch_card_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: server_heartbeats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.server_heartbeats ENABLE ROW LEVEL SECURITY;

--
-- Name: server_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.server_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: server_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.server_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_machine_plays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.slot_machine_plays ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_machines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.slot_machines ENABLE ROW LEVEL SECURITY;

--
-- Name: spawn_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spawn_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: speed_radar_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.speed_radar_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: stretcher_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stretcher_events ENABLE ROW LEVEL SECURITY;

--
-- Name: taxi_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.taxi_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: tow_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tow_events ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: uniform_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.uniform_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_access_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_access_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_asset_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_asset_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_dashboard_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_dashboard_events ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_repair_stations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_repair_stations ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_shop_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_shop_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_shop_spawn_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_shop_spawn_points ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_shop_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_shop_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: wanted_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wanted_records ENABLE ROW LEVEL SECURITY;

--
-- Name: weather_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weather_states ENABLE ROW LEVEL SECURITY;

--
-- Name: world_building_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_building_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: world_building_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_building_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: world_maps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_maps ENABLE ROW LEVEL SECURITY;

--
-- Name: world_placeables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_placeables ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict dNuVu22UrQ4PBcFMLxEEsgdG9y66u04X2P4sPJpJm3q1EJRZqyiMSFTalDMF4jS

