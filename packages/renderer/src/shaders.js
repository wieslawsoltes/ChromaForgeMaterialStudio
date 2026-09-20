export const WGSL = `
struct Uniforms {vp:mat4x4f, inv:mat4x4f, eye:vec4f, settings:vec4f, viewport:vec4f, visible:array<vec4f,4>, env:vec4f};
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var texColor:texture_2d_array<f32>;
@group(0) @binding(2) var texOrm:texture_2d_array<f32>;
@group(0) @binding(3) var texEmit:texture_2d_array<f32>;
@group(0) @binding(4) var samp:sampler;
struct VOut {@builtin(position) clip:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f,@location(3) @interpolate(flat) mat:u32,@location(4) bary:vec3f};
@vertex fn vs(@location(0) pos:vec3f,@location(1) norm:vec3f,@location(2) uv:vec2f,@location(3) mat:f32,@builtin(vertex_index) ix:u32)->VOut {
 var o:VOut;o.clip=u.vp*vec4f(pos,1);o.world=pos;o.normal=norm;o.uv=uv;o.mat=u32(mat);o.bary=vec3f(0);o.bary[ix%3u]=1;return o;
}
fn rotate(v:vec3f)->vec3f {let a=u.settings.y;return vec3f(v.x*cos(a)+v.z*sin(a),v.y,-v.x*sin(a)+v.z*cos(a));}
fn environment(dir:vec3f,r:f32)->vec3f {
 let d=rotate(dir);var col=mix(vec3f(.07,.078,.09),vec3f(.39,.43,.48),clamp(d.y*.5+.5,0.,1.));
 col+=vec3f(4.7,4.5,4.1)*pow(max(dot(d,normalize(vec3f(-.7,1.,1.))),0.),mix(180.,3.,r*r));
 col+=vec3f(1.9,2.5,3.3)*pow(max(dot(d,normalize(vec3f(1.,.3,-.7))),0.),mix(100.,2.,r*r));
 col+=vec3f(1.3)*pow(max(dot(d,normalize(vec3f(.2,.7,.7))),0.),mix(100.,2.,r*r));
 if(u.env.x>1.5){col*=vec3f(.35,.52,.85);}else if(u.env.x>.5){col*=vec3f(1.15,.88,.67);}return col;
}
fn brdf(n:vec3f,v:vec3f,l:vec3f,base:vec3f,r:f32,m:f32)->vec3f {
 let h=normalize(v+l);let nl=max(dot(n,l),0.);let nv=max(dot(n,v),.001);let nh=max(dot(n,h),0.);let hv=max(dot(h,v),0.);
 let a=max(r*r,.002);let a2=a*a;let den=nh*nh*(a2-1.)+1.;let D=a2/(3.14159265*den*den);let k=(r+1.)*(r+1.)/8.;let G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);
 let f0=mix(vec3f(.04),base,m);let F=f0+(1.-f0)*pow(1.-hv,5.);let spec=D*G*F/max(4.*nl*nv,.001);return ((1.-F)*(1.-m)*base/3.14159265+spec)*nl;
}
fn tonemap(x:vec3f)->vec3f{return pow(clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0),vec3f(1)),vec3f(1./2.2));}
@fragment fn fs(i:VOut)->@location(0) vec4f {
 let uv=vec2f(i.uv.x,1.-i.uv.y);let albedo=textureSample(texColor,samp,uv,i32(i.mat));let orm=textureSample(texOrm,samp,uv,i32(i.mat));let em=textureSample(texEmit,samp,uv,i32(i.mat));
 var n=normalize(i.normal);let v=normalize(u.eye.xyz-i.world);if(dot(n,v)<0.){n=-n;}
 let q1=dpdx(i.world);let q2=dpdy(i.world);let st1=dpdx(uv);let st2=dpdy(uv);let tangent=q1*st2.y-q2*st1.y;let bitangent=-q1*st2.x+q2*st1.x;
 let hdx=dpdx(orm.a);let hdy=dpdy(orm.a);let det=dot(tangent,tangent);if(det>0.00000001){let grad=cross(q2,n)*hdx+cross(n,q1)*hdy;let denom=dot(q1,cross(q2,n));if(abs(denom)>.00000001){n=normalize(n-grad/denom*u.settings.w*.045);}}
 let width=fwidth(i.bary);let wire=1.-min(min(smoothstep(vec3f(0),width*1.15,i.bary).x,smoothstep(vec3f(0),width*1.15,i.bary).y),smoothstep(vec3f(0),width*1.15,i.bary).z);
 if(u.visible[i.mat/4u][i.mat%4u]<.5||albedo.a<.05){discard;}
 let mode=u32(u.settings.z);var color:vec3f;
 if(mode==1u){color=albedo.rgb;}else if(mode==2u){color=vec3f(orm.g);}else if(mode==3u){color=vec3f(orm.b);}else if(mode==4u){color=n*.5+.5;}else if(mode==5u){color=vec3f(orm.a);}else if(mode==6u){color=em.rgb*2.;}else if(mode==7u){let c=(u32(floor(i.uv.x*16.))+u32(floor(i.uv.y*16.)))%2u;color=mix(vec3f(.18),vec3f(.7),f32(c));}else{
 let base=pow(albedo.rgb,vec3f(2.2));let rough=clamp(orm.g,.04,1.);let metal=orm.b;let f0=mix(vec3f(.04),base,metal);let nv=max(dot(n,v),0.);let F=f0+(1.-f0)*pow(1.-nv,5.);
 let env=environment(reflect(-v,n),rough);color=base*(1.-metal)*(.19+max(n.y,0.)*.22)+env*F*(1.-rough*.45);
 color+=brdf(n,v,rotate(normalize(vec3f(-.6,1.2,1.4))),base,rough,metal)*vec3f(2.9,2.65,2.4);
 color+=brdf(n,v,rotate(normalize(vec3f(1.3,.45,-.8))),base,rough,metal)*vec3f(1.4,1.8,2.4);
 color+=em.rgb*2.;color=tonemap(color*u.settings.x);
 }
 if(u.viewport.w>.5){color=mix(color,vec3f(.08,.1,.12),wire*.7);}return vec4f(color,1);
}
struct BOut{@builtin(position) clip:vec4f,@location(0) xy:vec2f};
@vertex fn bgvs(@builtin(vertex_index) i:u32)->BOut{var o:BOut;let x=f32(i/2u)*4.-1.;let y=f32(i%2u)*4.-1.;o.xy=vec2f(x,y);o.clip=vec4f(x,y,.9999,1);return o;}
@fragment fn bgfs(i:BOut)->@location(0) vec4f{
 var c=mix(vec3f(.105,.113,.123),vec3f(.18,.19,.205),clamp(i.xy.y*.5+.5,0.,1.));let pa=u.inv*vec4f(i.xy,0,1);let pb=u.inv*vec4f(i.xy,1,1);let a=pa.xyz/pa.w;let b=pb.xyz/pb.w;let d=normalize(b-a);
 let t=(-1.12-a.y)/d.y;let p=a+d*t;let grid1=abs(fract(p.xz+.5)-.5)/max(fwidth(p.xz),vec2f(.0001));let grid=1.-min(min(grid1.x,grid1.y),1.);let fade=exp(-length(p.xz)*.12);
 if(t>0.&&u.viewport.z>.5){c=mix(c,vec3f(.22,.235,.25),grid*.17*fade);let shadow=exp(-dot(p.xz/vec2f(1.5,1.1),p.xz/vec2f(1.5,1.1))*1.3);c*=1.-shadow*.54;}
 return vec4f(c,1);
}`;
export const GL_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;layout(location=1) in vec3 normal;layout(location=2) in vec2 uv;layout(location=3) in float material;
uniform mat4 vp;out vec3 world;out vec3 norm;out vec2 tc;flat out int mat;out vec3 bary;
void main(){gl_Position=vp*vec4(position,1.);gl_Position.z=gl_Position.z*2.-gl_Position.w;world=position;norm=normal;tc=uv;mat=int(material);bary=vec3(0);bary[gl_VertexID%3]=1.;}`;
export const GL_FRAGMENT = `#version 300 es
precision highp float;precision highp sampler2DArray;
in vec3 world;in vec3 norm;in vec2 tc;flat in int mat;in vec3 bary;out vec4 outColor;
uniform sampler2DArray texColor;uniform sampler2DArray texOrm;uniform sampler2DArray texEmit;uniform vec3 eye;uniform vec4 settings;uniform vec4 viewport;uniform float visible[16];uniform vec4 env;
vec3 rotateV(vec3 v){float a=settings.y;return vec3(v.x*cos(a)+v.z*sin(a),v.y,-v.x*sin(a)+v.z*cos(a));}
vec3 environment(vec3 dir,float r){vec3 d=rotateV(dir);vec3 col=mix(vec3(.07,.078,.09),vec3(.39,.43,.48),clamp(d.y*.5+.5,0.,1.));col+=vec3(4.7,4.5,4.1)*pow(max(dot(d,normalize(vec3(-.7,1.,1.))),0.),mix(180.,3.,r*r));col+=vec3(1.9,2.5,3.3)*pow(max(dot(d,normalize(vec3(1.,.3,-.7))),0.),mix(100.,2.,r*r));col+=vec3(1.3)*pow(max(dot(d,normalize(vec3(.2,.7,.7))),0.),mix(100.,2.,r*r));if(env.x>1.5)col*=vec3(.35,.52,.85);else if(env.x>.5)col*=vec3(1.15,.88,.67);return col;}
vec3 brdf(vec3 n,vec3 v,vec3 l,vec3 base,float r,float m){vec3 h=normalize(v+l);float nl=max(dot(n,l),0.),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.),hv=max(dot(h,v),0.),a=max(r*r,.002),a2=a*a,den=nh*nh*(a2-1.)+1.,D=a2/(3.14159265*den*den),k=(r+1.)*(r+1.)/8.,G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);vec3 f0=mix(vec3(.04),base,m),F=f0+(1.-f0)*pow(1.-hv,5.);return ((1.-F)*(1.-m)*base/3.14159265+D*G*F/max(4.*nl*nv,.001))*nl;}
vec3 tonemap(vec3 x){return pow(clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.),vec3(1./2.2));}
void main(){vec3 coord=vec3(tc.x,1.-tc.y,float(mat));vec4 albedo=texture(texColor,coord),orm=texture(texOrm,coord),em=texture(texEmit,coord);vec3 n=normalize(norm),v=normalize(eye-world);if(dot(n,v)<0.)n=-n;vec3 q1=dFdx(world),q2=dFdy(world);float denom=dot(q1,cross(q2,n));vec3 grad=cross(q2,n)*dFdx(orm.a)+cross(n,q1)*dFdy(orm.a);if(abs(denom)>.00000001)n=normalize(n-grad/denom*settings.w*.045);vec3 w=smoothstep(vec3(0),fwidth(bary)*1.15,bary);float wire=1.-min(min(w.x,w.y),w.z);if(visible[mat]<.5||albedo.a<.05)discard;int mode=int(settings.z);vec3 color;
if(mode==1)color=albedo.rgb;else if(mode==2)color=vec3(orm.g);else if(mode==3)color=vec3(orm.b);else if(mode==4)color=n*.5+.5;else if(mode==5)color=vec3(orm.a);else if(mode==6)color=em.rgb*2.;else if(mode==7)color=mix(vec3(.18),vec3(.7),float((int(floor(tc.x*16.))+int(floor(tc.y*16.)))%2));else{vec3 base=pow(albedo.rgb,vec3(2.2));float rough=clamp(orm.g,.04,1.),metal=orm.b,nv=max(dot(n,v),0.);vec3 f0=mix(vec3(.04),base,metal),F=f0+(1.-f0)*pow(1.-nv,5.);color=base*(1.-metal)*(.19+max(n.y,0.)*.22)+environment(reflect(-v,n),rough)*F*(1.-rough*.45);color+=brdf(n,v,rotateV(normalize(vec3(-.6,1.2,1.4))),base,rough,metal)*vec3(2.9,2.65,2.4);color+=brdf(n,v,rotateV(normalize(vec3(1.3,.45,-.8))),base,rough,metal)*vec3(1.4,1.8,2.4);color+=em.rgb*2.;color=tonemap(color*settings.x);}if(viewport.w>.5)color=mix(color,vec3(.08,.1,.12),wire*.7);outColor=vec4(color,1.);}`;
export const GL_BG_VERTEX = `#version 300 es
precision highp float;out vec2 xy;void main(){xy=vec2(float(gl_VertexID/2)*4.-1.,float(gl_VertexID%2)*4.-1.);gl_Position=vec4(xy,.9999,1.);}`;
export const GL_BG_FRAGMENT = `#version 300 es
precision highp float;in vec2 xy;out vec4 color;uniform mat4 inv;uniform vec4 viewport;
void main(){vec3 c=mix(vec3(.105,.113,.123),vec3(.18,.19,.205),clamp(xy.y*.5+.5,0.,1.));vec4 pa=inv*vec4(xy,0,1),pb=inv*vec4(xy,1,1);vec3 a=pa.xyz/pa.w,b=pb.xyz/pb.w,d=normalize(b-a);float t=(-1.12-a.y)/d.y;vec3 p=a+d*t;vec2 grid1=abs(fract(p.xz+.5)-.5)/max(fwidth(p.xz),vec2(.0001));float grid=1.-min(min(grid1.x,grid1.y),1.),fade=exp(-length(p.xz)*.12);if(t>0.&&viewport.z>.5){c=mix(c,vec3(.22,.235,.25),grid*.17*fade);float shadow=exp(-dot(p.xz/vec2(1.5,1.1),p.xz/vec2(1.5,1.1))*1.3);c*=1.-shadow*.54;}color=vec4(c,1.);}`;
