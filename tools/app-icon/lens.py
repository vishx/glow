"""Glow app icon artwork: champagne-titanium lens with a six-blade aperture and a sparkle flare.

icon(bg=...) returns a 1024px SVG. bg is 'metal' (the brushed warm-silver plate), 'ink' or 'none' (transparent).
"""
import math
S=1024; C=512
def star(cx,cy,r,w=0.2):
    pts=[]
    for i in range(4):
        a=math.radians(-90+90*i); b=math.radians(-45+90*i)
        pts.append((cx+r*math.cos(a),cy+r*math.sin(a))); pts.append((cx+r*w*math.cos(b),cy+r*w*math.sin(b)))
    d=f"M{pts[0][0]:.1f},{pts[0][1]:.1f} "
    for i in range(0,8,2):
        p=pts[(i+1)%8]; q=pts[(i+2)%8]; d+=f"Q{p[0]:.1f},{p[1]:.1f} {q[0]:.1f},{q[1]:.1f} "
    return d+"Z"
def icon(bg='metal', halo=('#9FC2FF','#C4B5FF','#FFD7A0'), iris_strength=0.8, R=312, shadow_on=True):
    if bg=='metal':
        bgdef='''<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FCFBF9"/><stop offset="0.3" stop-color="#ECE8E2"/><stop offset="0.62" stop-color="#D3CDC4"/><stop offset="0.85" stop-color="#EEEAE4"/><stop offset="1" stop-color="#C4BDB3"/></linearGradient>
 <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0.15" stop-color="#fff" stop-opacity="0"/><stop offset="0.32" stop-color="#fff" stop-opacity="0.85"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="0.7" stop-color="#fff" stop-opacity="0"/><stop offset="0.82" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.95" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <filter id="brush"><feTurbulence type="fractalNoise" baseFrequency="0.002 0.9" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0" intercept="0.10"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/></filter>'''
        bgdraw='<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#sweep)"/><rect width="1024" height="1024" fill="#fff" filter="url(#brush)" transform="rotate(-35 512 512) scale(1.5) translate(-170 -170)"/>'
        shadow='#3A352F'; shop=0.35
    elif bg=='none':
        bgdef=''; bgdraw=''; shadow='#3A352F'; shop=0.35
    else:
        bgdef='<radialGradient id="bg" cx="0.5" cy="0.42" r="0.8"><stop offset="0" stop-color="#2A2B30"/><stop offset="1" stop-color="#0F1012"/></radialGradient>'
        bgdraw='<rect width="1024" height="1024" fill="url(#bg)"/>'
        shadow='#000'; shop=0.5
    h1,h2,h3=halo
    shadow_el=f'<ellipse cx="{C+10}" cy="{C+40}" rx="{R}" ry="{R}" fill="{shadow}" opacity="{shop}" filter="url(#b40)"/>' if shadow_on else ''
    a=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">
<defs>{bgdef}
 <linearGradient id="rg" x1="0.15" y1="0.05" x2="0.85" y2="0.95"><stop offset="0" stop-color="#FFF9EE"/><stop offset="0.25" stop-color="#E6D3B2"/><stop offset="0.5" stop-color="#9C7E56"/><stop offset="0.72" stop-color="#F1E3C7"/><stop offset="1" stop-color="#AE9064"/></linearGradient>
 <linearGradient id="chrome" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="#E2E2E4"/><stop offset="0.55" stop-color="#94949A"/><stop offset="0.8" stop-color="#ECECEE"/><stop offset="1" stop-color="#88888E"/></linearGradient>
 <radialGradient id="barrel" cx="0.45" cy="0.4" r="0.6"><stop offset="0" stop-color="#3E4048"/><stop offset="0.7" stop-color="#22242A"/><stop offset="1" stop-color="#141518"/></radialGradient>
 <radialGradient id="glass" cx="0.42" cy="0.38" r="0.65"><stop offset="0" stop-color="#35506F"/><stop offset="0.6" stop-color="#1C2A3C"/><stop offset="1" stop-color="#0D1218"/></radialGradient>
 <radialGradient id="iris" cx="0.42" cy="0.38" r="0.62"><stop offset="0" stop-color="#6FA0D8" stop-opacity="{iris_strength}"/><stop offset="0.5" stop-color="#3A5F8F" stop-opacity="{iris_strength*0.8}"/><stop offset="1" stop-color="#121A24" stop-opacity="0"/></radialGradient>
 <radialGradient id="pupil" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#2E3440"/><stop offset="1" stop-color="#08090B"/></radialGradient>
 <radialGradient id="shine" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
 <filter id="b40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
 <filter id="b26" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
 <filter id="b14" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
 <clipPath id="gc"><circle cx="512" cy="512" r="{R-128}"/></clipPath><filter id="b2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter><filter id="b6"><feGaussianBlur stdDeviation="6"/></filter>
</defs>
{bgdraw}
{shadow_el}
<!-- iridescent halo -->
<linearGradient id="halo" x1="0" y1="0.2" x2="1" y2="0.8"><stop offset="0" stop-color="{h2}"/><stop offset="0.45" stop-color="{h1}"/><stop offset="1" stop-color="{h3}"/></linearGradient>
<circle cx="{C}" cy="{C}" r="{R+30}" fill="none" stroke="url(#halo)" stroke-width="140" filter="url(#b40)"/>
<circle cx="{C}" cy="{C}" r="{R+18}" fill="none" stroke="url(#halo)" stroke-width="70" filter="url(#b26)"/>
<circle cx="{C}" cy="{C}" r="{R+8}" fill="none" stroke="url(#halo)" stroke-width="30" filter="url(#b14)"/>
<circle cx="{C}" cy="{C}" r="{R+4}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="16" filter="url(#b6)" stroke-opacity="0.9"/>
<!-- rings -->
<circle cx="{C}" cy="{C}" r="{R}" fill="url(#rg)"/>
<circle cx="{C}" cy="{C}" r="{R-1}" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="3"/>
<circle cx="{C}" cy="{C}" r="{R-30}" fill="#1E2026"/>
<circle cx="{C}" cy="{C}" r="{R-38}" fill="url(#chrome)"/>
<circle cx="{C}" cy="{C}" r="{R-56}" fill="url(#rg)" opacity="0.9"/>
<circle cx="{C}" cy="{C}" r="{R-66}" fill="url(#barrel)"/>
''' 
    for i,rr in enumerate(range(R-78,R-128,-10)):
        a+=f'<circle cx="{C}" cy="{C}" r="{rr}" fill="none" stroke="#fff" stroke-opacity="{0.06+0.02*(i%2)}" stroke-width="2"/>'
    g=R-128
    import math as m
    pr=int(g*0.42); blades=''
    hexp=[(C+pr*1.02*m.cos(m.radians(-75+60*i)),C+pr*1.02*m.sin(m.radians(-75+60*i))) for i in range(6)]
    for i in range(6):
        x0,y0=hexp[i]; x1,y1=hexp[(i+1)%6]; dx,dy=x1-x0,y1-y0; L=m.hypot(dx,dy)
        ex,ey=x1+dx/L*g*1.2,y1+dy/L*g*1.2
        blades+=f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{ex:.0f}" y2="{ey:.0f}" stroke="#fff" stroke-opacity="0.13" stroke-width="3" clip-path="url(#gc)"/>'
    hp=' '.join(f'{x:.0f},{y:.0f}' for x,y in hexp)
    blades=f'<polygon points="{hp}" fill="#0B0D10" stroke="#fff" stroke-opacity="0.28" stroke-width="3"/>'+blades
    a+=f'''
<circle cx="{C}" cy="{C}" r="{g}" fill="url(#glass)"/>
<g opacity="1" filter="url(#b14)">
 <ellipse cx="{C-62}" cy="{C-36}" rx="62" ry="86" fill="#A898FF"/>
 <ellipse cx="{C+72}" cy="{C+34}" rx="62" ry="86" fill="#FFC98A"/>
 <ellipse cx="{C+10}" cy="{C-78}" rx="70" ry="34" fill="#7FC4FF"/>
</g>
<circle cx="{C}" cy="{C}" r="{g}" fill="url(#iris)"/>
<circle cx="{C}" cy="{C}" r="{g-40}" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="3"/>
<circle cx="{C}" cy="{C}" r="{int(g*0.42)}" fill="url(#pupil)"/>
<circle cx="{C}" cy="{C}" r="{int(g*0.42)}" fill="none" stroke="#A9C6EE" stroke-opacity="0.35" stroke-width="3"/>
{blades}
<!-- glass reflection arc -->
<path d="M{C-g+18},{C-20} A{g-18},{g-18} 0 0 1 {C-20},{C-g+18}" stroke="#fff" stroke-opacity="0.7" stroke-width="18" stroke-linecap="round" fill="none" filter="url(#b6)"/>
<!-- flare on the rim, drawn as Glow's four-point sparkle -->
'''
    fx,fy=C-int(R*0.56),C-int(R*0.56)
    a+=f'''<circle cx="{fx}" cy="{fy}" r="110" fill="url(#shine)" opacity="0.9"/>
<path d="M{fx-170},{fy} L{fx+170},{fy}" stroke="#fff" stroke-width="4" stroke-opacity="0.75" filter="url(#b2)"/><path d="M{fx},{fy-170} L{fx},{fy+170}" stroke="#fff" stroke-width="4" stroke-opacity="0.75" filter="url(#b2)"/>
<path d="{star(fx,fy,84,0.15)}" fill="#fff"/>
<path d="M{C+R*0.5:.0f},{C+R*0.87:.0f} A{R},{R} 0 0 0 {C+R*0.92:.0f},{C+R*0.38:.0f}" stroke="#fff" stroke-opacity="0.5" stroke-width="6" fill="none" stroke-linecap="round" filter="url(#b6)"/>
</svg>'''
    return a


def background():
    """The brushed warm-silver plate on its own (Android adaptive background layer)."""
    full = icon(bg='metal')
    defs = full[full.index('<defs>') + 6:full.index('<linearGradient id="rg"')]
    draw = full[full.index('</defs>') + 7:full.index('<ellipse')]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}"><defs>{defs}</defs>{draw}</svg>'


def monochrome():
    """One-colour silhouette for Android themed icons: rim, glass with aperture cut-out, sparkle."""
    R = 312; g = R - 128; pr = int(g * 0.42)
    hexp = ' '.join(f'{C + pr * 1.02 * math.cos(math.radians(-75 + 60 * i)):.0f},{C + pr * 1.02 * math.sin(math.radians(-75 + 60 * i)):.0f}' for i in range(6))
    fx = fy = C - int(R * 0.56)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">
<defs><mask id="m"><rect width="{S}" height="{S}" fill="#fff"/>
<circle cx="{C}" cy="{C}" r="{R - 44}" fill="#000"/>
<path d="{star(fx, fy, 112, 0.2)}" fill="#000"/>
</mask><mask id="h"><rect width="{S}" height="{S}" fill="#fff"/><polygon points="{hexp}" fill="#000"/><path d="{star(fx, fy, 112, 0.2)}" fill="#000"/></mask></defs>
<circle cx="{C}" cy="{C}" r="{R}" fill="#fff" mask="url(#m)"/>
<circle cx="{C}" cy="{C}" r="{g}" fill="#fff" mask="url(#h)"/>
<path d="{star(fx, fy, 84, 0.15)}" fill="#fff"/>
</svg>'''


def scaled(svg, k):
    """Wraps a 1024px SVG so its art shrinks to k of the canvas, centred (keeps it inside adaptive-icon safe zones)."""
    o = S * (1 - k) / 2
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}"><g transform="translate({o:.1f} {o:.1f}) scale({k})">{svg}</g></svg>'
