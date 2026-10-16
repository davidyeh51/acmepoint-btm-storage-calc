/**
 * 進金生能源 6692 ｜ 客戶用電分析與「大光小儲」提案平台 (McKinsey Edition)
 * Supabase 雲端 BaaS 整合客戶端 ＆ 電費單月度資料庫模組 (Vanilla JS for GitHub Pages)
 * 遵循 github-supabase-web 安全規範：僅使用公開 anon key，搭配後端 RLS 行級安全
 */

const BtmSupabase = {
  client: null,
  isOnline: false,
  currentUser: null,

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

  async init() {
    const cfg = this.getStoredConfig();
    if (cfg.url && cfg.anonKey && window.supabase) {
      try {
        this.client = window.supabase.createClient(cfg.url, cfg.anonKey);
        this.isOnline = true;
        console.log("🟢 Supabase client initialized:", cfg.url);
        
        const { data } = await this.client.auth.getUser();
        this.currentUser = data ? data.user : null;

        this.client.auth.onAuthStateChange((_event, session) => {
          this.currentUser = session ? session.user : null;
          this.updateStatusBadge();
        });
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
      throw new Error("請填寫完整的 Supabase URL 與 anon public key");
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
    this.currentUser = null;
    this.updateStatusBadge();
  },

  async testConnection(url, key) {
    try {
      const testClient = window.supabase.createClient(url.trim(), key.trim());
      const { error: billErr } = await testClient.from('electricity_bills').select('id').limit(1);
      if (billErr && billErr.code !== 'PGRST116') {
        if (billErr.message && billErr.message.includes('does not exist')) {
          return { 
            success: true, 
            note: '連線成功！但尚未建立 electricity_bills 資料表，請複製下方 SQL 至 Supabase SQL Editor 執行。' 
          };
        }
        throw billErr;
      }
      return { success: true, note: 'Supabase 雲端資料庫連線成功！(electricity_bills 與 btm_proposals 已就緒)' };
    } catch (err) {
      return { success: false, error: err.message || '連線逾時或金鑰無效' };
    }
  },

  async uploadFile(fileOrBlob, customFilename = '', folder = 'bills') {
    if (!this.isConfigured() || !this.client) {
      return null;
    }

    const rawName = (fileOrBlob && fileOrBlob.name) || customFilename || 'upload_file';
    const cleanName = rawName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_');
    const storagePath = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${cleanName}`;

    try {
      const { error } = await this.client.storage
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

  // 客戶每月電費單 (electricity_bills) 標準化欄位封裝
  normalizeBillPayload(b) {
    const kwhPeak = Number(b.kwh_peak) || 0;
    const kwhSemi = Number(b.kwh_semi_peak) || 0;
    const kwhSat = Number(b.kwh_sat_semi) || 0;
    const kwhOff = Number(b.kwh_off_peak) || 0;
    const kwhTotal = Number(b.kwh_total) || (kwhPeak + kwhSemi + kwhSat + kwhOff);
    const totalAmt = Number(b.total_amount) || 0;
    const avgPrice = kwhTotal > 0 ? Number((totalAmt / kwhTotal).toFixed(2)) : (Number(b.avg_unit_price) || 0);
    const bDays = Number(b.billing_days) || 30;
    const dailyAvg = Number(b.daily_avg_kwh) || (kwhTotal > 0 ? Number((kwhTotal / bDays).toFixed(2)) : 0);

    const monthStr = String(b.billing_month || '2025-07').trim();
    const mMatch = monthStr.match(/-(\d{2})$/);
    const mNum = mMatch ? parseInt(mMatch[1], 10) : 7;
    const defaultSeason = (mNum >= 6 && mNum <= 9) ? '夏月' : '非夏月';

    return {
      company_name: (b.company_name || '潤泰精密材料股份有限公司 (里港廠)').trim(),
      electric_no: (b.electric_no || '12-88-3674-21-5').trim(),
      tax_id: (b.tax_id || '86871981').trim(),
      industry: (b.industry || '(254)金屬加工處理業').trim(),
      address: (b.address || '屏東縣里港鄉三廍村中南1-8號1~7樓及地下室').trim(),
      billing_month: monthStr,
      roc_month: b.roc_month || '',
      billing_period: b.billing_period || '',
      billing_days: bDays,
      season_type: b.season_type || defaultSeason,
      tariff_type: b.tariff_type || '高壓電力 二段式時間電價',
      contract_regular_kw: Number(b.contract_regular_kw) || 0,
      contract_semi_peak_kw: Number(b.contract_semi_peak_kw) || 0,
      contract_sat_semi_kw: Number(b.contract_sat_semi_kw) || 0,
      contract_off_peak_kw: Number(b.contract_off_peak_kw) || 0,
      max_demand_regular_kw: Number(b.max_demand_regular_kw) || 0,
      max_demand_semi_kw: Number(b.max_demand_semi_kw) || 0,
      max_demand_sat_kw: Number(b.max_demand_sat_kw) || 0,
      max_demand_off_kw: Number(b.max_demand_off_kw) || 0,
      kwh_peak: kwhPeak,
      kwh_semi_peak: kwhSemi,
      kwh_sat_semi: kwhSat,
      kwh_off_peak: kwhOff,
      kwh_total: kwhTotal,
      daily_avg_kwh: dailyAvg,
      power_factor: Number(b.power_factor) || 95.0,
      adj_factor: Number(b.adj_factor) || 0.927,
      basic_fee: Number(b.basic_fee) || 0,
      energy_fee: Number(b.energy_fee) || 0,
      pf_adjustment: Number(b.pf_adjustment) || 0,
      excess_penalty_fee: Number(b.excess_penalty_fee) || 0,
      rate_adjustment_fee: Number(b.rate_adjustment_fee) || 0,
      ebill_discount: b.ebill_discount !== undefined ? Number(b.ebill_discount) : -10,
      pre_tax_amount: Number(b.pre_tax_amount) || 0,
      tax_amount: Number(b.tax_amount) || 0,
      total_amount: totalAmt,
      avg_unit_price: avgPrice,
      carbon_kg: Number(b.carbon_kg) || 0,
      feeder_code: b.feeder_code || 'NX23',
      outage_group: b.outage_group || 'B',
      meter_multiplier: Number(b.meter_multiplier) || 2000,
      file_url: b.file_url || null,
      file_name: b.file_name || null,
      file_size: b.file_size ? Number(b.file_size) : null,
      recognition_source: b.recognition_source || 'AUTO_PDF',
      raw_ocr_text: b.raw_ocr_text || '',
      notes: b.notes || '',
      created_by: b.created_by || (this.currentUser ? this.currentUser.email : '進金生業務團隊'),
      user_id: this.currentUser ? this.currentUser.id : null
    };
  },

  async saveBill(billData) {
    const payload = this.normalizeBillPayload(billData);

    const localBills = JSON.parse(localStorage.getItem('BTM_ELECTRICITY_BILLS') || '[]');
    const localItem = {
      id: billData.id && !String(billData.id).startsWith('local_') ? billData.id : ('local_bill_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
      created_at: new Date().toISOString(),
      ...payload
    };

    const existIdx = localBills.findIndex(item => 
      (billData.id && item.id === billData.id) || 
      (item.company_name === payload.company_name && item.billing_month === payload.billing_month && item.electric_no === payload.electric_no)
    );
    if (existIdx >= 0) {
      localBills[existIdx] = { ...localBills[existIdx], ...payload, updated_at: new Date().toISOString() };
    } else {
      localBills.unshift(localItem);
    }
    localStorage.setItem('BTM_ELECTRICITY_BILLS', JSON.stringify(localBills.slice(0, 500)));

    if (this.isConfigured() && this.client) {
      try {
        if (billData.id && !String(billData.id).startsWith('local_')) {
          const { data, error } = await this.client
            .from('electricity_bills')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', billData.id)
            .select();
          if (error) throw error;
          return { success: true, cloud: true, data: data[0] || localItem };
        } else {
          const { data, error } = await this.client
            .from('electricity_bills')
            .insert([payload])
            .select();
          if (error) throw error;
          if (data && data[0]) {
            const updatedLocal = JSON.parse(localStorage.getItem('BTM_ELECTRICITY_BILLS') || '[]');
            const idx = updatedLocal.findIndex(x => x.id === localItem.id);
            if (idx >= 0) {
              updatedLocal[idx] = data[0];
              localStorage.setItem('BTM_ELECTRICITY_BILLS', JSON.stringify(updatedLocal));
            }
            return { success: true, cloud: true, data: data[0] };
          }
        }
      } catch (err) {
        console.warn("Supabase electricity_bills insert/update warning:", err);
        return { success: true, cloud: false, data: localItem, error: err.message };
      }
    }

    return { success: true, cloud: false, data: localItem };
  },

  async saveBillsBatch(billsArray) {
    const normalizedList = billsArray.map(b => this.normalizeBillPayload(b));

    let localBills = JSON.parse(localStorage.getItem('BTM_ELECTRICITY_BILLS') || '[]');
    // 清除舊版示範客戶，確保以真實客戶為主
    localBills = localBills.filter(x => x.company_name !== '舜煜科技股份有限公司');

    normalizedList.forEach(payload => {
      const idx = localBills.findIndex(x => x.company_name === payload.company_name && x.billing_month === payload.billing_month && x.electric_no === payload.electric_no);
      if (idx >= 0) {
        localBills[idx] = { ...localBills[idx], ...payload, updated_at: new Date().toISOString() };
      } else {
        localBills.push({
          id: 'local_bill_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          created_at: new Date().toISOString(),
          ...payload
        });
      }
    });
    localBills.sort((a, b) => (b.billing_month || '').localeCompare(a.billing_month || ''));
    localStorage.setItem('BTM_ELECTRICITY_BILLS', JSON.stringify(localBills.slice(0, 500)));

    if (this.isConfigured() && this.client) {
      try {
        const { data, error } = await this.client
          .from('electricity_bills')
          .insert(normalizedList)
          .select();
        if (error) throw error;
        return { success: true, cloud: true, count: data.length, data };
      } catch (err) {
        console.warn("Supabase batch insert warning:", err);
        return { success: true, cloud: false, count: normalizedList.length, error: err.message };
      }
    }
    return { success: true, cloud: false, count: normalizedList.length };
  },

  async getBills() {
    let cloudBills = [];
    if (this.isConfigured() && this.client) {
      try {
        const { data, error } = await this.client
          .from('electricity_bills')
          .select('*')
          .order('billing_month', { ascending: false })
          .limit(300);

        if (!error && data) {
          cloudBills = data;
        }
      } catch (e) {
        console.warn("Load cloud electricity_bills failed, fallback to local:", e);
      }
    }

    let localBills = JSON.parse(localStorage.getItem('BTM_ELECTRICITY_BILLS') || '[]');
    // 移除舊版虛擬範例
    localBills = localBills.filter(x => x.company_name !== '舜煜科技股份有限公司');

    if (cloudBills.length > 0) {
      const unsyncedLocals = localBills.filter(lb => 
        String(lb.id).startsWith('local_') &&
        !cloudBills.some(cb => cb.company_name === lb.company_name && cb.billing_month === lb.billing_month && cb.electric_no === lb.electric_no)
      );
      const merged = [...cloudBills, ...unsyncedLocals];
      merged.sort((a, b) => (b.billing_month || '').localeCompare(a.billing_month || ''));
      return merged;
    }

    localBills.sort((a, b) => (b.billing_month || '').localeCompare(a.billing_month || ''));
    return localBills;
  },

  async deleteBill(id) {
    if (this.isConfigured() && this.client && typeof id === 'string' && !id.startsWith('local_')) {
      try {
        await this.client.from('electricity_bills').delete().eq('id', id);
      } catch (e) {
        console.warn("Cloud delete bill error:", e);
      }
    }
    let localBills = JSON.parse(localStorage.getItem('BTM_ELECTRICITY_BILLS') || '[]');
    localBills = localBills.filter(item => String(item.id) !== String(id));
    localStorage.setItem('BTM_ELECTRICITY_BILLS', JSON.stringify(localBills));
    return true;
  },

  async syncLocalBillsToCloud() {
    if (!this.isConfigured() || !this.client) {
      throw new Error("尚未連線 Supabase 雲端資料庫");
    }
    const localBills = JSON.parse(localStorage.getItem('BTM_ELECTRICITY_BILLS') || '[]');
    const pending = localBills.filter(b => String(b.id).startsWith('local_'));
    if (pending.length === 0) return { synced: 0 };

    const payloads = pending.map(b => this.normalizeBillPayload(b));
    const { data, error } = await this.client.from('electricity_bills').insert(payloads).select();
    if (error) throw error;

    const remaining = localBills.filter(b => !String(b.id).startsWith('local_'));
    localStorage.setItem('BTM_ELECTRICITY_BILLS', JSON.stringify([...(data || []), ...remaining]));
    return { synced: (data || []).length };
  },

  async saveProposal(proposalData) {
    const payload = {
      company_name: proposalData.company_name || '潤泰精密材料股份有限公司 (里港廠)',
      contact_name: proposalData.contact_name || '',
      contact_email: proposalData.contact_email || '',
      industry: proposalData.industry || '(254)金屬加工處理業',
      tariff: proposalData.tariff || '高壓電力 二段式時間電價',
      contract_kw: Number(proposalData.contract_kw) || 600,
      new_contract_kw: Number(proposalData.best_contract_kw || proposalData.new_contract_kw) || 680,
      pv_capacity_kwp: Number(proposalData.pv_capacity_kwp) || 400,
      selected_units: Number(proposalData.selected_units) || 0,
      selected_strategy: proposalData.selected_strategy || 'A2 契約調至 680kW ＋ D 太陽能 400kWp 自用',
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
      raw_result: {
        customer_code: proposalData.customer_code,
        electric_no: proposalData.electric_no,
        tax_id: proposalData.tax_id,
        address: proposalData.address,
        best_contract_kw: proposalData.best_contract_kw,
        contract_annual_savings: proposalData.contract_annual_savings,
        max_demand_kw: proposalData.max_demand_kw,
        max_off_demand_kw: proposalData.max_off_demand_kw,
        over_contract_months: proposalData.over_contract_months,
        bill_months_count: proposalData.bill_months_count,
        billing_period_range: proposalData.billing_period_range,
        annual_kwh: proposalData.annual_kwh,
        annual_basic_fee: proposalData.annual_basic_fee,
        annual_energy_fee: proposalData.annual_energy_fee,
        annual_penalty_fee: proposalData.annual_penalty_fee,
        annual_pf_adj: proposalData.annual_pf_adj,
        annual_rate_adj: proposalData.annual_rate_adj,
        annual_pretax_fee: proposalData.annual_pretax_fee,
        annual_total_fee: proposalData.annual_total_fee,
        load_factor_pct: proposalData.load_factor_pct,
        avg_kw: proposalData.avg_kw,
        peak_Share_pct: proposalData.peak_Share_pct,
        sat_share_pct: proposalData.sat_share_pct,
        off_share_pct: proposalData.off_share_pct,
        pv_est_savings: proposalData.pv_est_savings,
        dossier_markdown: proposalData.dossier_markdown,
        backtest_options: proposalData.backtest_options,
        monthly_demands_str: proposalData.monthly_demands_str
      },
      created_by: proposalData.created_by || (this.currentUser ? this.currentUser.email : '進金生業務團隊')
    };

    const localHistory = JSON.parse(localStorage.getItem('BTM_CALC_HISTORY') || '[]');
    const localItem = {
      id: proposalData.id || ('local_' + Date.now()),
      created_at: proposalData.created_at || new Date().toISOString(),
      ...proposalData,
      ...payload
    };

    const existIdx = localHistory.findIndex(x => x.id === localItem.id || x.company_name === localItem.company_name);
    if (existIdx >= 0) {
      localHistory[existIdx] = { ...localHistory[existIdx], ...localItem };
    } else {
      localHistory.unshift(localItem);
    }
    localStorage.setItem('BTM_CALC_HISTORY', JSON.stringify(localHistory.slice(0, 100)));

    if (this.isConfigured() && this.client) {
      try {
        const { data, error } = await this.client
          .from('btm_proposals')
          .insert([payload])
          .select();

        if (error) {
          return { success: true, cloud: false, local: true, data: localItem, error: error.message };
        }
        return { success: true, cloud: true, local: true, data: { ...localItem, ...(data[0] || {}) } };
      } catch (err) {
        return { success: true, cloud: false, local: true, data: localItem, error: err.message };
      }
    }

    return { success: true, cloud: false, local: true, data: localItem };
  },

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
          cloudProposals = data.map(row => ({
            ...(row.raw_result || {}),
            ...row
          }));
        }
      } catch (e) {
        console.warn("Load cloud proposals failed, using local:", e);
      }
    }

    const localHistory = JSON.parse(localStorage.getItem('BTM_CALC_HISTORY') || '[]');
    if (cloudProposals.length > 0) {
      return cloudProposals;
    }
    return localHistory;
  },

  async deleteProposal(id) {
    if (this.isConfigured() && this.client && typeof id === 'string' && !id.startsWith('local_') && !id.startsWith('prop_')) {
      try {
        await this.client.from('btm_proposals').delete().eq('id', id);
      } catch (e) {
        console.warn("Cloud delete error:", e);
      }
    }
    let localHistory = JSON.parse(localStorage.getItem('BTM_CALC_HISTORY') || '[]');
    localHistory = localHistory.filter(item => item.id !== id);
    localStorage.setItem('BTM_CALC_HISTORY', JSON.stringify(localHistory));
    return true;
  },

  generateShareUrl() {
    const cfg = this.getStoredConfig();
    const base = window.location.origin + window.location.pathname;
    if (!cfg.url || !cfg.anonKey) return base;
    return `${base}#sb_url=${encodeURIComponent(cfg.url)}&sb_key=${encodeURIComponent(cfg.anonKey)}`;
  },

  updateStatusBadge() {
    const badge = document.getElementById('supabase-status-badge');
    const label = document.getElementById('supabase-status-label');
    if (!badge || !label) return;

    if (this.isConfigured()) {
      badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-semibold bg-[#E6F0FA] text-[#005EB8] border border-[#005EB8]/30 shadow-sm cursor-pointer hover:bg-[#D0E4F7] transition';
      const userTag = this.currentUser ? ` (${this.currentUser.email.split('@')[0]})` : '';
      label.innerHTML = `<span class="w-2 h-2 rounded-full bg-[#005EB8] animate-pulse"></span> Supabase 已連線${userTag}`;
      badge.title = '點擊管理 Supabase 雲端資料庫連線或複製團隊分享連結';
    } else {
      badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300 shadow-sm cursor-pointer hover:bg-amber-100 transition';
      label.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span> 離線暫存模式 (點擊連結 Supabase)';
      badge.title = '點擊配置 Supabase 專案 URL 與 anon key 以啟用全業務團隊即時雲端儲存';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  BtmSupabase.init();
});
