-- ============================================================================
-- 進金生能源 6692 ｜ 錶後儲能用電大戶收益試算與投報率評估平台 (POXA CALC Replica)
-- Supabase 後端資料庫綱要與 RLS 行級安全設定
-- 適用於 GitHub Pages 純前端託管環境 (遵循 github-supabase-web 規範)
-- ============================================================================

-- 1. 建立儲能評估提案資料表 (btm_proposals)
CREATE TABLE IF NOT EXISTS public.btm_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    contact_email TEXT,
    industry TEXT DEFAULT '預設',
    tariff TEXT DEFAULT '高壓二段式電價',
    contract_kw NUMERIC NOT NULL DEFAULT 500,
    new_contract_kw NUMERIC,
    selected_units INTEGER DEFAULT 2,
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
    created_by TEXT DEFAULT '進金生業務團隊'
);

-- 2. 建立索引加速查詢
CREATE INDEX IF NOT EXISTS idx_btm_proposals_created_at ON public.btm_proposals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_btm_proposals_company_name ON public.btm_proposals(company_name);

-- 3. 開啟 RLS 行級安全保護 (強制)
ALTER TABLE public.btm_proposals ENABLE ROW LEVEL SECURITY;

-- 4. 建立存取原則 (RLS Policies)
-- 允許公開讀取團隊歷史提案
DROP POLICY IF EXISTS "允許公開讀取提案" ON public.btm_proposals;
CREATE POLICY "允許公開讀取提案" 
ON public.btm_proposals 
FOR SELECT 
USING (true);

-- 允許業務團隊 (anon 公開金鑰與登入使用者) 新增與保存試算
DROP POLICY IF EXISTS "允許業務團隊新增提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊新增提案" 
ON public.btm_proposals 
FOR INSERT 
TO anon, authenticated 
WITH CHECK (true);

-- 允許更新提案
DROP POLICY IF EXISTS "允許業務團隊更新提案" ON public.btm_proposals;
CREATE POLICY "允許業務團隊更新提案" 
ON public.btm_proposals 
FOR UPDATE 
TO anon, authenticated 
USING (true)
WITH CHECK (true);

-- 5. Storage 儲存桶設定 (供電費單 PDF 與需量數據 CSV 上傳)
-- 於 Supabase Dashboard > Storage 建立 bucket 名為 'btm-files' (Public)
-- 或執行下列 Storage Policy (若有 storage 權限)：
INSERT INTO storage.buckets (id, name, public) 
VALUES ('btm-files', 'btm-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 允許任何人下載與查看上傳之檔案
DROP POLICY IF EXISTS "允許公開查看 BTM 檔案" ON storage.objects;
CREATE POLICY "允許公開查看 BTM 檔案" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'btm-files');

-- 允許業務人員上傳電費單與 CSV
DROP POLICY IF EXISTS "允許業務人員上傳 BTM 檔案" ON storage.objects;
CREATE POLICY "允許業務人員上傳 BTM 檔案" 
ON storage.objects 
FOR INSERT 
TO anon, authenticated 
WITH CHECK (bucket_id = 'btm-files');
