/**
 * 進金生能源 6692 ｜ 錶後儲能用電大戶收益試算平台 (BTM Energy Storage Platform)
 * Supabase 雲端 BaaS 整合客戶端 ＆ 離線同步模組 (Vanilla JS for GitHub Pages)
 */

const BtmSupabase = {
  client: null,
  isOnline: false,

  // 1. 初始化與讀取憑證 (支援 URL 參數 #sb_url=...&sb_key=... 自動配對)
  getStoredConfig() {
    try {
      const rawHash = window.location.hash.replace(/^#/, '');
      const rawSearch = window.location.search.replace(/^\?/, '');
      const searchStr = rawHash.includes('sb_url') ? rawHash : (rawSearch.includes('sb_url') ? rawSearch : '');
      
      if (searchStr.includes('sb_url')) {
        const params = new URLSearchParams(searchStr);
        const pUrl = params.get('sb_url');
        const pKey = params.get('sb_key');
        if (pUrl && pKey) {
          localStorage.setItem('BTM_SB_URL', pUrl.trim());
          localStorage.setItem('BTM_SB_KEY', pKey.trim());
          // 清除網址列憑證以維護安全性
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    } catch (e) {
      console.warn("Parse URL params note:", e);
    }

    const localUrl = localStorage.getItem('BTM_SB_URL') || localStorage.getItem('SB_URL') || '';
    const localKey = localStorage.getItem('BTM_SB_KEY') || localStorage.getItem('SB_ANON_KEY') || '';
    const defUrl = window.DEFAULT_SUPABASE_URL || 'https://cowljafosekwvxithwjd.supabase.co';

    return {
      url: (localUrl && localUrl.trim()) ? localUrl.trim() : defUrl,
      anonKey: (localKey && localKey.trim()) ? localKey.trim() : ''
    };
  },

  init() {
    const cfg = this.getStoredConfig();
    if (cfg.url && cfg.anonKey && window.supabase) {
      try {
        this.client = window.supabase.createClient(cfg.url, cfg.anonKey);
        this.isOnline = true;
        console.log("🟢 Supabase client initialized:", cfg.url);
      } catch (e) {
        console.warn("Supabase init error:", e);
        this.client = null;
        this.isOnline = false;
      }
    } else {
      this.client = null;
      this.isOnline = false;
    }
    this.updateStatusBadge();
    return this.isOnline;
  },

  isConfigured() {
    return !!(this.client && this.isOnline);
  },

  saveConfig(url, anonKey) {
    if (!url || !anonKey) {
      throw new Error("請填寫完整的 Supabase URL 與 anon key");
    }
    localStorage.setItem('BTM_SB_URL', url.trim());
    localStorage.setItem('BTM_SB_KEY', anonKey.trim());
    return this.init();
  },

  clearConfig() {
    localStorage.removeItem('BTM_SB_URL');
    localStorage.removeItem('BTM_SB_KEY');
    this.client = null;
    this.isOnline = false;
    this.updateStatusBadge();
  },

  async testConnection(url, key) {
    try {
      const testClient = window.supabase.createClient(url.trim(), key.trim());
      const { data, error } = await testClient.from('btm_proposals').select('id').limit(1);
      if (error && error.code !== 'PGRST116') {
        // 如果只是資料表尚未建立或權限問題，但能連通
        if (error.message && error.message.includes('relation "public.btm_proposals" does not exist')) {
          return { success: true, note: '連線成功！但尚未建立 btm_proposals 資料表，請先於 Supabase SQL Editor 執行 schema.sql。' };
        }
        throw error;
      }
      return { success: true, note: 'Supabase 連線成功！雲端資料庫已就緒。' };
    } catch (err) {
      return { success: false, error: err.message || '連線逾時或金鑰無效' };
    }
  },

  // 2. 上傳電費單 PDF 或用電需量 CSV 到 Supabase Storage (btm-files)
  async uploadFile(fileOrBlob, customFilename = '') {
    if (!this.isConfigured() || !this.client) {
      console.warn("未連線 Supabase，將使用本地暫存");
      return null;
    }

    const rawName = (fileOrBlob && fileOrBlob.name) || customFilename || 'upload_file';
    const cleanName = rawName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_');
    const storagePath = `proposals/${Date.now()}_${cleanName}`;

    try {
      const { data, error } = await this.client.storage
        .from('btm-files')
        .upload(storagePath, fileOrBlob, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        console.warn("Storage upload error:", error);
        return null;
      }

      const { data: pubData } = this.client.storage.from('btm-files').getPublicUrl(storagePath);
      return {
        url: pubData ? pubData.publicUrl : '',
        path: storagePath,
        name: rawName,
        size: fileOrBlob.size || 0
      };
    } catch (e) {
      console.error("Storage upload exception:", e);
      return null;
    }
  },

  // 3. 儲存試算提案 (若無雲端則自動存入 LocalStorage)
  async saveProposal(proposalData) {
    const payload = {
      company_name: proposalData.company_name || '未命名企業',
      contact_name: proposalData.contact_name || '',
      contact_email: proposalData.contact_email || '',
      industry: proposalData.industry || '預設',
      tariff: proposalData.tariff || '高壓二段式電價',
      contract_kw: Number(proposalData.contract_kw) || 500,
      new_contract_kw: Number(proposalData.new_contract_kw) || null,
      selected_units: Number(proposalData.selected_units) || 2,
      selected_strategy: proposalData.selected_strategy || '電價套利-日選2h-即時聚合',
      irr: Number(proposalData.irr) || null,
      roi: Number(proposalData.roi) || null,
      payback_years: Number(proposalData.payback_years) || null,
      total_capex: Number(proposalData.total_capex) || null,
      annual_savings: Number(proposalData.annual_savings) || null,
      load_curve_id: proposalData.load_curve_id || '17902',
      notes: proposalData.notes || '',
      file_url: proposalData.file_url || null,
      file_name: proposalData.file_name || null,
      file_size: proposalData.file_size || null,
      raw_payload: proposalData.raw_payload || {},
      raw_result: proposalData.raw_result || {},
      created_by: proposalData.created_by || '進金生業務'
    };

    // 本地備份
    const localHistory = JSON.parse(localStorage.getItem('BTM_CALC_HISTORY') || '[]');
    const localItem = {
      id: 'local_' + Date.now(),
      created_at: new Date().toISOString(),
      ...payload
    };
    localHistory.unshift(localItem);
    localStorage.setItem('BTM_CALC_HISTORY', JSON.stringify(localHistory.slice(0, 100)));

    // 雲端同步
    if (this.isConfigured() && this.client) {
      try {
        const { data, error } = await this.client
          .from('btm_proposals')
          .insert([payload])
          .select();

        if (error) {
          console.error("Supabase insert error:", error);
          return { success: true, cloud: false, local: true, data: localItem, error: error.message };
        }
        return { success: true, cloud: true, local: true, data: data[0] };
      } catch (err) {
        console.warn("Supabase network error, saved locally:", err);
        return { success: true, cloud: false, local: true, data: localItem, error: err.message };
      }
    }

    return { success: true, cloud: false, local: true, data: localItem };
  },

  // 4. 讀取團隊所有歷史提案 (優先自 Supabase 雲端載入，離線則回傳 LocalStorage)
  async getProposals() {
    let cloudProposals = [];
    if (this.isConfigured() && this.client) {
      try {
        const { data, error } = await this.client
          .from('btm_proposals')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        if (!error && data) {
          cloudProposals = data;
        }
      } catch (e) {
        console.warn("Load cloud proposals failed, using local:", e);
      }
    }

    const localHistory = JSON.parse(localStorage.getItem('BTM_CALC_HISTORY') || '[]');
    
    // 合併與去重 (若有雲端 ID 則以雲端為主)
    if (cloudProposals.length > 0) {
      return cloudProposals;
    }
    return localHistory;
  },

  // 5. 刪除提案
  async deleteProposal(id) {
    if (this.isConfigured() && this.client && typeof id === 'string' && !id.startsWith('local_')) {
      try {
        await this.client.from('btm_proposals').delete().eq('id', id);
      } catch (e) {
        console.warn("Cloud delete error:", e);
      }
    }
    // 本地刪除
    let localHistory = JSON.parse(localStorage.getItem('BTM_CALC_HISTORY') || '[]');
    localHistory = localHistory.filter(item => item.id !== id);
    localStorage.setItem('BTM_CALC_HISTORY', JSON.stringify(localHistory));
    return true;
  },

  // 6. 產生一鍵分享連結 (讓業務團隊免輸入金鑰直接連線使用)
  generateShareUrl() {
    const cfg = this.getStoredConfig();
    const base = window.location.origin + window.location.pathname;
    if (!cfg.url || !cfg.anonKey) return base;
    return `${base}#sb_url=${encodeURIComponent(cfg.url)}&sb_key=${encodeURIComponent(cfg.anonKey)}`;
  },

  // 7. 更新頂部狀態指示徽章
  updateStatusBadge() {
    const badge = document.getElementById('supabase-status-badge');
    const label = document.getElementById('supabase-status-label');
    if (!badge || !label) return;

    if (this.isConfigured()) {
      badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-sm cursor-pointer hover:bg-emerald-100 transition';
      label.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> 雲端資料庫已連線';
      badge.title = '點擊檢視 Supabase 連線設定或產生團隊分享連結';
    } else {
      badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 shadow-sm cursor-pointer hover:bg-amber-100 transition';
      label.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span> 本地模式 (點擊連線雲端)';
      badge.title = '點擊配置 Supabase 專案 URL 與金鑰以啟用多業務團隊即時雲端同步';
    }
  }
};

// 頁面載入時自動初始化
document.addEventListener('DOMContentLoaded', () => {
  BtmSupabase.init();
});
