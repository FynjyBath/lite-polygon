#include <cstdio>
#include <algorithm>
#include <cstring>
using namespace std;

const int N = (int) 1e6 + 1;
const int inf = (int) 1e9;
int res, n, m, l, r, len[N], ans[N], p[N];
char s[N], tmp[N];
char *wrd[N];

bool match(char * a, char * b, int l) {
	for (int i = 0; i < l; ++i)
		if (a[i] != b[i]) return false;
	return true;
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
		wrd[i] = new char[len[i] + 1];
		strcpy(wrd[i], tmp);
	}
	scanf("%s", s);
	m = strlen(s);
	for (int i = 0; i < m; ++i) {
		p[i] = -1;
		for (int j = 0; j < n; ++j)
			if ((i + len[j] <= m) && match(s + i, wrd[j], len[j])) {
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