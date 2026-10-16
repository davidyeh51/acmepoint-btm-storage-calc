-- ============================================================================
-- 進金生能源 6692 ｜ 客戶用電分析與「大光小儲」提案平台 (McKinsey Edition)
-- Supabase 後端資料庫綱要 (PostgreSQL) 與 RLS 行級安全設定
-- 內建客戶 #1：潤泰精密材料股份有限公司 (里港廠) 114年02月~115年01月 12 個月真實電費單資料
-- ============================================================================

-- 1. 建立「客戶每月電費單結構化資料表」 (public.electricity_bills)
CREATE TABLE IF NOT EXISTS public.electricity_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- 客戶與帳單基本識別
    company_name TEXT NOT NULL DEFAULT '未命名客戶',
    electric_no TEXT DEFAULT '',                        -- 台電 11 碼電號 (例: 12-88-3674-21-5)
    tax_id TEXT DEFAULT '',                             -- 營利事業統一編號 (例: 86871981)
    industry TEXT DEFAULT '',                           -- 行業別 (例: (254)金屬加工處理業)
    address TEXT DEFAULT '',                            -- 用電地址
    billing_month TEXT NOT NULL,                        -- 繳費憑證年月 (格式: YYYY-MM，例: 2025-07)
    roc_month TEXT DEFAULT '',                          -- 民國年月 (例: 114年07月)
    billing_period TEXT DEFAULT '',                     -- 計費期間 (例: 114/06/01至114/06/30)
    billing_days INTEGER DEFAULT 30,                    -- 用電日數 (例: 30)
    season_type TEXT DEFAULT '夏月',                    -- 夏月 (計費期間 6~9月) / 非夏月 (10~5月)
    tariff_type TEXT DEFAULT '高壓電力 二段式時間電價', -- 電價種類與時間種類
    
    -- 契約容量 (kW)
    contract_regular_kw NUMERIC DEFAULT 0,              -- 經常(尖峰)契約容量 (kW)
    contract_semi_peak_kw NUMERIC DEFAULT 0,            -- 半尖峰/非夏月契約容量 (kW)
    contract_sat_semi_kw NUMERIC DEFAULT 0,             -- 週六半尖峰契約容量 (kW)
    contract_off_peak_kw NUMERIC DEFAULT 0,             -- 離峰契約容量 (kW)
    
    -- 當月最高需量 (kW)
    max_demand_regular_kw NUMERIC DEFAULT 0,            -- 經常(尖峰)最高需量 (kW)
    max_demand_semi_kw NUMERIC DEFAULT 0,               -- 半尖峰最高需量 (kW)
    max_demand_sat_kw NUMERIC DEFAULT 0,                -- 週六半尖峰最高需量 (kW)
    max_demand_off_kw NUMERIC DEFAULT 0,                -- 離峰最高需量 (kW)
    
    -- 各時段用電度數 (kWh)
    kwh_peak NUMERIC DEFAULT 0,                         -- 尖峰度數 (kWh)
    kwh_semi_peak NUMERIC DEFAULT 0,                    -- 半尖峰度數 (kWh)
    kwh_sat_semi NUMERIC DEFAULT 0,                     -- 週六半尖峰度數 (kWh)
    kwh_off_peak NUMERIC DEFAULT 0,                     -- 離峰度數 (kWh)
    kwh_total NUMERIC DEFAULT 0,                        -- 當月總計費度數 (kWh)
    daily_avg_kwh NUMERIC DEFAULT 0,                    -- 日平均度數 (kWh/日)
    
    -- 電費結構與功因指標 (NT$ / %)
    power_factor NUMERIC DEFAULT 95.0,                  -- 功率因數 (%)
    adj_factor NUMERIC DEFAULT 1.0,                     -- 行業別調整係數 (例: 0.927)
    basic_fee NUMERIC DEFAULT 0,                        -- 基本電費(約定) (元)
    energy_fee NUMERIC DEFAULT 0,                       -- 流動電費 (元)
    pf_adjustment NUMERIC DEFAULT 0,                    -- 功率因數調整費 (元，折扣為負值)
    excess_penalty_fee NUMERIC DEFAULT 0,               -- 基本電費(非約定) / 超約附加費 (元)
    rate_adjustment_fee NUMERIC DEFAULT 0,              -- 電價調整金額 (元，例: -92931.7)
    ebill_discount NUMERIC DEFAULT -10,                 -- 電子帳單優惠減收金額 (元)
    pre_tax_amount NUMERIC DEFAULT 0,                   -- 稅前應繳總金額 (元)
    tax_amount NUMERIC DEFAULT 0,                       -- 營業稅 (元)
    total_amount NUMERIC DEFAULT 0,                     -- 繳費總金額 (元)
    avg_unit_price NUMERIC DEFAULT 0,                   -- 平均每度電價 (元/度)
    
    -- 電網與排碳其他資訊
    carbon_kg NUMERIC DEFAULT 0,                        -- 電力排碳量 (公斤)
    feeder_code TEXT DEFAULT '',                        -- 饋線代號 (例: NX23)
    outage_group TEXT DEFAULT '',                       -- 輪流停電組別 (例: B)
    meter_multiplier INTEGER DEFAULT 2000,              -- 電表倍數 (例: 2000)
    
    -- 原始電費單檔案與雲端備查資訊
    file_url TEXT,                                      -- 原始電費單 PDF 預覽/下載連結
    file_name TEXT,                                     -- 原始上傳檔案名稱
    file_size BIGINT,                                   -- 檔案大小 (Bytes)
    recognition_source TEXT DEFAULT 'AUTO_PDF',         -- 辨識來源
    raw_ocr_text TEXT,                                  -- 原始擷取文字備份
    notes TEXT DEFAULT '',                              -- 業務備註
    created_by TEXT DEFAULT '進金生業務團隊',           -- 建立人員
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 若資料表已存在，安全補齊擴充欄位
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS tax_id TEXT DEFAULT '';
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS industry TEXT DEFAULT '';
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS roc_month TEXT DEFAULT '';
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS billing_period TEXT DEFAULT '';
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS billing_days INTEGER DEFAULT 30;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS daily_avg_kwh NUMERIC DEFAULT 0;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS adj_factor NUMERIC DEFAULT 1.0;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS rate_adjustment_fee NUMERIC DEFAULT 0;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS ebill_discount NUMERIC DEFAULT -10;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS pre_tax_amount NUMERIC DEFAULT 0;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS carbon_kg NUMERIC DEFAULT 0;
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS feeder_code TEXT DEFAULT '';
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS outage_group TEXT DEFAULT '';
ALTER TABLE public.electricity_bills ADD COLUMN IF NOT EXISTS meter_multiplier INTEGER DEFAULT 2000;

CREATE INDEX IF NOT EXISTS idx_electricity_bills_company ON public.electricity_bills(company_name);
CREATE INDEX IF NOT EXISTS idx_electricity_bills_electric_no ON public.electricity_bills(electric_no);
CREATE INDEX IF NOT EXISTS idx_electricity_bills_month ON public.electricity_bills(billing_month DESC);

ALTER TABLE public.electricity_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "允許讀取電費單資料" ON public.electricity_bills;
CREATE POLICY "允許讀取電費單資料" ON public.electricity_bills FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "允許業務新增電費單" ON public.electricity_bills;
CREATE POLICY "允許業務新增電費單" ON public.electricity_bills FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務更新電費單" ON public.electricity_bills;
CREATE POLICY "允許業務更新電費單" ON public.electricity_bills FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務刪除電費單" ON public.electricity_bills;
CREATE POLICY "允許業務刪除電費單" ON public.electricity_bills FOR DELETE TO anon, authenticated USING (true);


-- 2. 建立「大光小儲＆用電分析提案資料表」 (public.btm_proposals)
CREATE TABLE IF NOT EXISTS public.btm_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    contact_email TEXT,
    industry TEXT DEFAULT '(254)金屬加工處理業',
    tariff TEXT DEFAULT '高壓二段式電價',
    contract_kw NUMERIC NOT NULL DEFAULT 600,
    new_contract_kw NUMERIC,
    pv_capacity_kwp NUMERIC DEFAULT 500,
    selected_units INTEGER DEFAULT 1,
    selected_strategy TEXT DEFAULT '電價套利-日選2h-即時聚合',
    irr NUMERIC,
    roi NUMERIC,
    payback_years NUMERIC,
    total_capex NUMERIC,
    annual_savings NUMERIC,
    load_curve_id TEXT DEFAULT '17902',
    notes TEXT,
    file_url TEXT,
    file_name TEXT,
    file_size BIGINT,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    raw_result JSONB DEFAULT '{}'::jsonb,
    created_by TEXT DEFAULT '進金生業務團隊',
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.btm_proposals ADD COLUMN IF NOT EXISTS pv_capacity_kwp NUMERIC DEFAULT 500;
ALTER TABLE public.btm_proposals ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.btm_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "允許公開讀取提案" ON public.btm_proposals;
CREATE POLICY "允許公開讀取提案" ON public.btm_proposals FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "允許業務團隊新增提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊新增提案" ON public.btm_proposals FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務團隊更新提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊更新提案" ON public.btm_proposals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務團隊刪除提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊刪除提案" ON public.btm_proposals FOR DELETE TO anon, authenticated USING (true);


-- 3. Storage 儲存桶設定 (btm-files)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('btm-files', 'btm-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "允許公開查看 BTM 檔案" ON storage.objects;
CREATE POLICY "允許公開查看 BTM 檔案" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'btm-files');

DROP POLICY IF EXISTS "允許業務人員上傳 BTM 檔案" ON storage.objects;
CREATE POLICY "允許業務人員上傳 BTM 檔案" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'btm-files');

DROP POLICY IF EXISTS "允許業務人員更新 BTM 檔案" ON storage.objects;
CREATE POLICY "允許業務人員更新 BTM 檔案" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'btm-files');
