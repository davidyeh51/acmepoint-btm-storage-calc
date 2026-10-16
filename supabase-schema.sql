-- ============================================================================
-- 進金生能源 6692 ｜ 客戶用電分析與「大光小儲」提案平台 (McKinsey Edition)
-- Supabase 後端資料庫綱要 (PostgreSQL) 與 RLS 行級安全設定
-- 適用於 GitHub Pages 純前端託管環境 (遵循 github-supabase-web 安全規範)
-- ============================================================================

-- ============================================================================
-- 1. 建立「客戶每月電費單結構化資料表」 (public.electricity_bills)
--    儲存業務每個月上傳之客戶電費單自動辨識欄位與原始檔案雲端連結
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.electricity_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- 客戶與帳單基本識別
    company_name TEXT NOT NULL DEFAULT '未命名客戶',
    electric_no TEXT DEFAULT '',                        -- 台電 11 碼電號 (例: 08-12-3456-78-9)
    billing_month TEXT NOT NULL,                        -- 計費年月 (格式: YYYY-MM，例: 2026-07)
    season_type TEXT DEFAULT '夏月',                    -- 夏月 (6~9月) / 非夏月 (10~5月)
    tariff_type TEXT DEFAULT '高壓三段式時間電價',      -- 電價種類 (高壓二段式 / 高壓三段式 / 特高壓三段式 / 批次生產等)
    
    -- 契約容量 (kW)
    contract_regular_kw NUMERIC DEFAULT 0,              -- 經常契約容量 (kW)
    contract_semi_peak_kw NUMERIC DEFAULT 0,            -- 半尖峰/非夏月契約容量 (kW)
    contract_sat_semi_kw NUMERIC DEFAULT 0,             -- 週六半尖峰契約容量 (kW)
    contract_off_peak_kw NUMERIC DEFAULT 0,             -- 離峰契約容量 (kW)
    
    -- 當月最高需量 (kW)
    max_demand_regular_kw NUMERIC DEFAULT 0,            -- 經常最高需量 (kW)
    max_demand_semi_kw NUMERIC DEFAULT 0,               -- 半尖峰最高需量 (kW)
    max_demand_sat_kw NUMERIC DEFAULT 0,                -- 週六半尖峰最高需量 (kW)
    max_demand_off_kw NUMERIC DEFAULT 0,                -- 離峰最高需量 (kW)
    
    -- 各時段用電度數 (kWh)
    kwh_peak NUMERIC DEFAULT 0,                         -- 尖峰用電度數 (kWh)
    kwh_semi_peak NUMERIC DEFAULT 0,                    -- 半尖峰用電度數 (kWh)
    kwh_sat_semi NUMERIC DEFAULT 0,                     -- 週六半尖峰度數 (kWh)
    kwh_off_peak NUMERIC DEFAULT 0,                     -- 離峰用電度數 (kWh)
    kwh_total NUMERIC DEFAULT 0,                        -- 當月總用電度數 (kWh)
    
    -- 電費結構與功因指標 (NT$ / %)
    power_factor NUMERIC DEFAULT 95.0,                  -- 功率因數 (%)
    basic_fee NUMERIC DEFAULT 0,                        -- 基本電費 (元)
    energy_fee NUMERIC DEFAULT 0,                       -- 流動電費 (元)
    excess_penalty_fee NUMERIC DEFAULT 0,               -- 超約附加費 (元)
    pf_adjustment NUMERIC DEFAULT 0,                    -- 功率因數調整費 (元，折扣為負值)
    total_amount NUMERIC DEFAULT 0,                     -- 總應繳電費金額 (元)
    avg_unit_price NUMERIC DEFAULT 0,                   -- 平均每度電價 (元/度)
    
    -- 原始電費單檔案與雲端備查資訊
    file_url TEXT,                                      -- Supabase Storage 公開預覽/下載連結
    file_name TEXT,                                     -- 原始上傳檔案名稱
    file_size BIGINT,                                   -- 檔案大小 (Bytes)
    recognition_source TEXT DEFAULT 'AUTO_OCR',         -- 辨識來源 (PDF_TEXT / OCR_IMAGE / EXCEL_IMPORT / MANUAL)
    raw_ocr_text TEXT,                                  -- 原始擷取文字備份
    notes TEXT DEFAULT '',                              -- 業務備註
    created_by TEXT DEFAULT '進金生業務團隊',           -- 建立人員
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 建立索引加速客戶篩選與月份排序
CREATE INDEX IF NOT EXISTS idx_electricity_bills_company ON public.electricity_bills(company_name);
CREATE INDEX IF NOT EXISTS idx_electricity_bills_electric_no ON public.electricity_bills(electric_no);
CREATE INDEX IF NOT EXISTS idx_electricity_bills_month ON public.electricity_bills(billing_month DESC);
CREATE INDEX IF NOT EXISTS idx_electricity_bills_created_at ON public.electricity_bills(created_at DESC);

-- 開啟 RLS 行級安全保護 (強制)
ALTER TABLE public.electricity_bills ENABLE ROW LEVEL SECURITY;

-- 建立存取原則 (RLS Policies - 供業務團隊即時協作讀寫)
DROP POLICY IF EXISTS "允許讀取電費單資料" ON public.electricity_bills;
CREATE POLICY "允許讀取電費單資料"
ON public.electricity_bills
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "允許業務新增電費單" ON public.electricity_bills;
CREATE POLICY "允許業務新增電費單"
ON public.electricity_bills
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務更新電費單" ON public.electricity_bills;
CREATE POLICY "允許業務更新電費單"
ON public.electricity_bills
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務刪除電費單" ON public.electricity_bills;
CREATE POLICY "允許業務刪除電費單"
ON public.electricity_bills
FOR DELETE
TO anon, authenticated
USING (true);


-- ============================================================================
-- 2. 建立「大光小儲＆用電分析提案資料表」 (public.btm_proposals)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.btm_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    contact_email TEXT,
    industry TEXT DEFAULT '預設',
    tariff TEXT DEFAULT '高壓三段式電價',
    contract_kw NUMERIC NOT NULL DEFAULT 1000,
    new_contract_kw NUMERIC,
    pv_capacity_kwp NUMERIC DEFAULT 800,                -- 大光小儲：建議太陽能光電容量 (kWp)
    selected_units INTEGER DEFAULT 1,                   -- 大光小儲：建議儲能櫃台數 (125kW/261kWh)
    selected_strategy TEXT DEFAULT '大光小儲-尖峰削峰與電價套利',
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

-- 若舊表已存在，安全補齊大光小儲擴充欄位
ALTER TABLE public.btm_proposals ADD COLUMN IF NOT EXISTS pv_capacity_kwp NUMERIC DEFAULT 800;
ALTER TABLE public.btm_proposals ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_btm_proposals_created_at ON public.btm_proposals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_btm_proposals_company_name ON public.btm_proposals(company_name);

ALTER TABLE public.btm_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "允許公開讀取提案" ON public.btm_proposals;
CREATE POLICY "允許公開讀取提案" 
ON public.btm_proposals 
FOR SELECT 
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "允許業務團隊新增提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊新增提案" 
ON public.btm_proposals 
FOR INSERT 
TO anon, authenticated 
WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務團隊更新提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊更新提案" 
ON public.btm_proposals 
FOR UPDATE 
TO anon, authenticated 
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "允許業務團隊刪除提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊刪除提案" 
ON public.btm_proposals 
FOR DELETE 
TO anon, authenticated 
USING (true);


-- ============================================================================
-- 3. Storage 儲存桶設定 (供每個月電費單 PDF/影像 與 15分鐘需量數據 CSV 上傳)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('btm-files', 'btm-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "允許公開查看 BTM 檔案" ON storage.objects;
CREATE POLICY "允許公開查看 BTM 檔案" 
ON storage.objects 
FOR SELECT 
TO anon, authenticated
USING (bucket_id = 'btm-files');

DROP POLICY IF EXISTS "允許業務人員上傳 BTM 檔案" ON storage.objects;
CREATE POLICY "允許業務人員上傳 BTM 檔案" 
ON storage.objects 
FOR INSERT 
TO anon, authenticated 
WITH CHECK (bucket_id = 'btm-files');

DROP POLICY IF EXISTS "允許業務人員更新 BTM 檔案" ON storage.objects;
CREATE POLICY "允許業務人員更新 BTM 檔案" 
ON storage.objects 
FOR UPDATE 
TO anon, authenticated 
USING (bucket_id = 'btm-files');
