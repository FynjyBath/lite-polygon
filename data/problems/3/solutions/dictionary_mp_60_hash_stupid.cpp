#include <cstdio>
#include <algorithm>
#include <cstring>
using namespace std;

const int N = (int) 1e6 + 1;
const int inf = (int) 1e9;
const int P = 17239;
int res, n, m, l, r, len[N], ans[N], p[N], h[N], wrdh[N], ppow[N];
char s[N], tmp[N];

void calc_hash(char * s, int n, int * h) {
	h[0] = 0, ppow[0] = 1;
	for (int i = 0; i < n; ++i)
		h[i + 1] = h[i] * P + s[i], ppow[i + 1] = ppow[i] * P;
}

int get_path(int l, int r) {
	int res = 0;
	while ((l != -1) && (l < r)) l = p[l], ++res;
	if (l != r) res = -1;
	return res;
}

int main() {
	scanf("%d", &n);
	for (int i = 0; i < n; ++i) {
		scanf("%s", tmp);
		len[i] = strlen(tmp);
		calc_hash(tmp, len[i], h);
		wrdh[i] = h[len[i]];
	}
	scanf("%s", s);
	m = strlen(s);
	calc_hash(s, m, h);
	for (int i = 0; i < m; ++i) {
		p[i] = -1;
		for (int j = 0; j < n; ++j)
			if ((i + len[j] <= m) && (h[i + len[j]] - h[i] * ppow[len[j]] == wrdh[j])) {
				p[i] = i + len[j];
				break;
			}
	}
	n = m;
	scanf("%d", &m);
	for (int i = 0; i < m; ++i) {
		scanf("%d%d", &l, &r), --l;
		printf("%d\n", get_path(l, r));
	}
	scanf("%d", &m);
	for (int i = 0; i < m; ++i) {
		int sum = 0, t, a, b, c, d, e, l, r;
		scanf("%d %d %d %d %d %d %d %d", &t, &a, &b, &c, &d, &e, &l, &r);
		for (int j = 0; j < t; ++j) {
			int ans = get_path(min(l % n, r % n), max(l % n, r % n) + 1);
			if (ans != -1) sum = (sum + ans) % e;
			l = (a * l + b) % e, r = (c * r + d + ans) % e;
		}
		printf("%d\n", sum);
	}
	return 0;
}