/**
 * Supabase 客户端单例
 *
 * 未配置环境变量时返回 null，游戏以纯本地模式运行。
 * 环境变量（.env）：
 *   VITE_SUPABASE_URL        - Supabase 项目 URL
 *   VITE_SUPABASE_ANON_KEY   - 匿名公钥
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let client: ReturnType<typeof createClient> | null = null;

/**
 * 获取 Supabase 客户端。
 * 返回 null 表示未配置，应用运行在纯本地模式。
 */
export function getSupabase() {
  if (!client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('Supabase not configured. Running without database.');
      return null;
    }
    client = createClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}
