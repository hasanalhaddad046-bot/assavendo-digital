import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:NextRequest) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const code=request.nextUrl.searchParams.get("code");
  const target=(path:string)=>new URL(path,request.url).toString();
  const response=NextResponse.redirect(target("/admin"));
  const fail=(error:string)=>{
    response.headers.set("Location",target("/admin/login?err="+encodeURIComponent(error)));
    return response;
  };
  if(!url||!key||!code) return fail("auth_config");

  const supabase=createServerClient(url,key,{
    cookies:{
      getAll(){return request.cookies.getAll();},
      setAll(values,headers){
        values.forEach(({name,value,options})=>{
          request.cookies.set(name,value);
          response.cookies.set(name,value,options);
        });
        Object.entries(headers).forEach(([name,value])=>response.headers.set(name,value));
      },
    },
  });
  const {error:exchangeError}=await supabase.auth.exchangeCodeForSession(code);
  if(exchangeError) return fail("auth");

  const {data:{user},error:userError}=await supabase.auth.getUser();
  if(userError||!user?.email) {
    await supabase.auth.signOut();
    return fail("auth");
  }

  try {
    const admin=supabaseAdmin();
    const {data:member,error}=await admin.from("admin_members")
      .select("active,email").eq("user_id",user.id).maybeSingle();
    if(error||!member||!member.active||member.email.toLowerCase()!==user.email.toLowerCase()) {
      await supabase.auth.signOut();
      return fail("not_invited");
    }
    await admin.from("admin_members").update({
      last_login_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }).eq("user_id",user.id);
  } catch {
    await supabase.auth.signOut();
    return fail("service_config");
  }
  return response;
}
