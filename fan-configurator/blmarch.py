"""Integral boundary-layer march on DFDC's inviscid wall velocities.

Why this exists: DFDC's own BL analysis (blcalc.f) is a post-process that is
only reliable in forward flight.  In hover the stagnation point sits at the
duct trailing edge on the outer surface, the march starts there, the dead air
on the outside trips its separation flag almost immediately, and the code then
integrates an empirical separated profile around the whole wall - including
the inner wall, which is the one that matters for a diffuser.

This module marches a classic integral boundary layer along a wall using the
edge velocity Ue(s) that DFDC computed (CPWR output):

    laminar     Thwaites' method (Cebeci-Bradshaw correlations)
    transition  Michel's criterion, or forced at laminar separation
    turbulent   Head's entrainment method, Ludwieg-Tillman skin friction
    separation  turbulent H >= H_SEP (2.4, "imminent separation" in Head's
                method, the value used by Moran and Cebeci & Bradshaw)

It is a diagnostic, not a coupled viscous solution: it tells you where the
inviscid pressure recovery can no longer be sustained.  The thrust correction
estimates what the inviscid solution falsely credits downstream of that point
by holding the wall pressure at its separation value (dead-air plateau).

References: Moran, "An Introduction to Theoretical and Computational
Aerodynamics", ch. 7; Cebeci & Bradshaw, "Momentum Transfer in Boundary
Layers"; Kline, Abbott & Fox (1959) and Reneau, Johnston & Kline (1967) for
the diffuser stall map.
"""
import math

H_SEP = 2.4
LAM_SEP = -0.09


# ----------------------------------------------------------------------------
# correlations
# ----------------------------------------------------------------------------

def _thwaites_hl(lam):
    lam = max(-0.1, min(0.1, lam))
    if lam >= 0:
        H = 2.61 - 3.75 * lam + 5.24 * lam * lam
        l = 0.22 + 1.57 * lam - 1.8 * lam * lam
    else:
        H = 2.088 + 0.0731 / (lam + 0.14)
        l = 0.22 + 1.402 * lam + 0.018 * lam / (lam + 0.107)
    return H, l


def _h1_of_h(H):
    H = max(1.05, H)
    if H <= 1.6:
        return 3.3 + 0.8234 * (H - 1.1) ** -1.287
    return 3.3 + 1.5501 * (H - 0.6778) ** -3.064


def _h_of_h1(H1):
    H1 = max(3.3 + 1e-6, H1)
    if H1 >= 5.3:
        return 1.1 + 0.86 * (H1 - 3.3) ** -0.777
    return 0.6778 + 1.1538 * (H1 - 3.3) ** -0.326


def _cf_lt(H, re_theta):
    return 0.246 * 10.0 ** (-0.678 * H) * max(1.0, re_theta) ** -0.268


def _head_rhs(ue, due, theta, H1, nu):
    H = _h_of_h1(H1)
    re_t = ue * theta / nu
    cf = _cf_lt(H, re_t)
    dtheta = 0.5 * cf - (H + 2.0) * theta / ue * due
    F = 0.0306 * max(1e-3, H1 - 3.0) ** -0.6169
    # d(ue*theta*H1)/ds = ue*F  ->  dH1/ds
    dH1 = (ue * F - H1 * (due * theta + ue * dtheta)) / (ue * theta)
    return dtheta, dH1, H, cf


# ----------------------------------------------------------------------------
# march
# ----------------------------------------------------------------------------

def march(points, nu, x_trans=None):
    """points: [(x, r, cp, ue)] ordered from the stagnation point downstream.
    Returns dict with per-point arrays and the transition / separation stations."""
    n = len(points)
    if n < 4:
        return None
    xs = [p[0] for p in points]
    rs = [p[1] for p in points]
    ue = [max(0.0, p[3]) for p in points]
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + math.hypot(xs[i] - xs[i - 1], rs[i] - rs[i - 1]))
    L = s[-1] or 1.0

    theta = [0.0] * n
    H = [2.6] * n
    cf = [0.0] * n
    state = ["lam"] * n          # lam | turb | sep
    i_tr = None
    i_sep = None

    # ---- laminar: Thwaites ---------------------------------------------------
    I = 0.0
    i0 = next((i for i in range(n) if ue[i] > 0.5), None)
    if i0 is None:
        return None
    for i in range(i0, n):
        if i > i0:
            I += 0.5 * (ue[i] ** 5 + ue[i - 1] ** 5) * (s[i] - s[i - 1])
        th2 = 0.45 * nu * I / max(ue[i], 1e-6) ** 6
        if i == i0:
            th2 = 0.075 * nu / max(1e-6, (ue[i0 + 1] - ue[i0]) / max(1e-9, s[i0 + 1] - s[i0]))  # stagnation-point value
        theta[i] = math.sqrt(max(th2, 1e-16))
        due = (ue[min(n - 1, i + 1)] - ue[max(0, i - 1)]) / max(1e-9, s[min(n - 1, i + 1)] - s[max(0, i - 1)])
        lam = theta[i] ** 2 / nu * due
        Hi, l = _thwaites_hl(lam)
        re_t = ue[i] * theta[i] / nu
        H[i] = Hi
        cf[i] = 2.0 * l / max(re_t, 1.0)
        re_x = ue[i] * s[i] / nu
        michel = re_t > 1.174 * (1.0 + 22400.0 / max(re_x, 1.0)) * max(re_x, 1.0) ** 0.46
        forced = x_trans is not None and s[i] / L >= x_trans
        if (lam <= LAM_SEP or michel or forced) and i > i0 + 1:
            i_tr = i
            break
    if i_tr is None:
        return _pack(xs, rs, s, ue, theta, H, cf, state, None, None, i0)

    # ---- turbulent: Head -------------------------------------------------------
    th = theta[i_tr]
    H1 = _h1_of_h(1.4)                # usual post-transition value
    state[i_tr] = "turb"
    H[i_tr] = 1.4
    for i in range(i_tr + 1, n):
        if ue[i] <= 0.5 or ue[i - 1] <= 0.5:
            # wall velocity collapsed (e.g. a blunt base): treat as separated
            i_sep = i
            break
        ds_tot = s[i] - s[i - 1]
        ratio = abs(ue[i] - ue[i - 1]) / max(ue[i - 1], 1e-6)
        nsub = min(400, 2 + int(ratio * 40 + ds_tot / L * 200))
        h = ds_tot / nsub
        sep_here = False
        for k in range(nsub):
            f = (k + 0.5) / nsub
            u_m = ue[i - 1] + (ue[i] - ue[i - 1]) * f
            du = (ue[i] - ue[i - 1]) / ds_tot
            # RK2 (midpoint)
            d1, e1, _, _ = _head_rhs(u_m, du, th, H1, nu)
            th_h = max(1e-7, th + 0.5 * h * d1)
            H1_h = max(3.301, H1 + 0.5 * h * e1)
            d2, e2, Hm, _ = _head_rhs(u_m, du, th_h, H1_h, nu)
            th = max(1e-7, th + h * d2)
            H1 = max(3.301, H1 + h * e2)
            if _h_of_h1(H1) >= H_SEP:
                sep_here = True
                break
        theta[i] = th
        H[i] = _h_of_h1(H1)
        cf[i] = _cf_lt(H[i], ue[i] * th / nu)
        state[i] = "turb"
        if sep_here:
            i_sep = i
            break
    if i_sep is not None:
        for i in range(i_sep, n):
            state[i] = "sep"
            theta[i] = theta[i_sep - 1] if i_sep > 0 else theta[i]
            H[i] = max(H[i_sep - 1], H_SEP)
            cf[i] = 0.0
    return _pack(xs, rs, s, ue, theta, H, cf, state, i_tr, i_sep, i0)


TE_ONLY = 0.04     # separation inside the last 4 % of a wall is ordinary trailing-edge separation


def _pack(xs, rs, s, ue, theta, H, cf, state, i_tr, i_sep, i0):
    frac = ((s[-1] - s[i_sep]) / (s[-1] or 1.0)) if i_sep is not None else 0.0
    return dict(
        x=xs, r=rs, s=s, ue=ue, theta=theta, H=H, cf=cf, state=state,
        s_max=s[-1], i_start=i0,
        i_tr=i_tr, x_tr=(xs[i_tr] if i_tr is not None else None),
        i_sep=i_sep, x_sep=(xs[i_sep] if i_sep is not None else None),
        separated=i_sep is not None and frac >= TE_ONLY,
        te_only=i_sep is not None and frac < TE_ONLY,
        sep_fraction=frac,
    )


# ----------------------------------------------------------------------------
# thrust credited downstream of separation
# ----------------------------------------------------------------------------

def plateau_thrust_change(points, i_sep, q_ref, fluid_inside):
    """Replace Cp downstream of separation with Cp at separation and integrate the
    axial pressure force change on the wall (N, thrust positive).

    points: [(x, r, cp, ue)] ordered upstream -> downstream.
    fluid_inside: True when the fluid is on the small-r side of the wall (duct
    inner surface), False for the duct outer surface and the centerbody.
    A wall segment faces downstream (pressure on it pushes the body upstream,
    i.e. gives thrust) when r grows along the march on an inner wall, or
    shrinks on an outer wall."""
    if i_sep is None or i_sep >= len(points) - 1:
        return 0.0
    cp_sep = points[i_sep][2]
    dT = 0.0
    for i in range(i_sep, len(points) - 1):
        x0, r0, cp0, _ = points[i]
        x1, r1, cp1, _ = points[i + 1]
        dr = r1 - r0
        faces_down = (dr > 0) if fluid_inside else (dr < 0)
        area = 2.0 * math.pi * 0.5 * (r0 + r1) * abs(dr)
        cp_mid = 0.5 * (cp0 + cp1)
        dT += (cp_sep - cp_mid) * q_ref * area * (1.0 if faces_down else -1.0)
    return dT


# ----------------------------------------------------------------------------
# conical-diffuser rule of thumb
# ----------------------------------------------------------------------------

# Kline/Reneau "line of first appreciable stall" for conical diffusers,
# approximated as total cone angle 2*theta versus length / inlet radius.
_FIRST_STALL = [(1.0, 20.0), (2.0, 14.0), (4.0, 10.0), (8.0, 8.0), (16.0, 7.0)]


def first_stall_angle(l_over_r):
    l = max(_FIRST_STALL[0][0], min(_FIRST_STALL[-1][0], l_over_r))
    for (l0, a0), (l1, a1) in zip(_FIRST_STALL, _FIRST_STALL[1:]):
        if l0 <= l <= l1:
            return a0 + (a1 - a0) * (math.log(l / l0) / math.log(l1 / l0))
    return _FIRST_STALL[-1][1]


def diffuser_check(r_wall_in, r_hub_in, r_wall_out, r_hub_out, length):
    """Equivalent conical diffuser from the rotor-plane annulus to the exit annulus."""
    a1 = math.pi * max(0.0, r_wall_in ** 2 - r_hub_in ** 2)
    a2 = math.pi * max(0.0, r_wall_out ** 2 - r_hub_out ** 2)
    if a1 <= 0 or length <= 0:
        return None
    r1 = math.sqrt(a1 / math.pi)
    r2 = math.sqrt(a2 / math.pi)
    two_theta = 2.0 * math.degrees(math.atan2(r2 - r1, length))
    l_r = length / r1
    limit = first_stall_angle(l_r)
    if two_theta <= 0:
        verdict = "nozzle"
    elif two_theta < 0.75 * limit:
        verdict = "attached"
    elif two_theta < limit:
        verdict = "marginal"
    elif two_theta < 1.6 * limit:
        verdict = "transitory stall"
    else:
        verdict = "fully stalled"
    return dict(area_ratio=a2 / a1, l_over_r=l_r, cone_angle=two_theta,
                first_stall_angle=limit, verdict=verdict)
