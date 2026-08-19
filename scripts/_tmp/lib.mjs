import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
const root = path.resolve(process.cwd())
const env = Object.fromEntries(fs.readFileSync(path.join(root,'.env.local'),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()]}))
export const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}})
