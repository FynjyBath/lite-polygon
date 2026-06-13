#include <iostream>
#include <fstream>
#include <set>
#include <vector>
#include <cstring>
#include <list>
#include <algorithm>

using namespace std;


long long base = 239;

const int mod = 1000003;
const int nmax = 1e6 + 1e5;

struct node
{
	long long value;
	node* next;
};

node BIGARRAY[nmax];
int BIGARRAYLEN = 0;

typedef node* pnode;

pnode allocate()
{
	return &BIGARRAY[BIGARRAYLEN ++];
}


void node_insert(pnode& v, long long x)
{
	pnode q = allocate();
	q -> value = x;
	q -> next = v;
	v = q;
};

const int shift = 23;

const int dmax = 1e7 + 10;
int compressed_div[dmax];

struct hash_table
{
	pnode l[1 << shift];
	void insert(long long h)
	{
		int hv = h & ((1 << shift) - 1);
		for (pnode it = l[hv]; it; it = it -> next)
			if (it->value == h)
				return;
		node_insert(l[hv], h);
	}
	bool has(long long h)
	{
		int hv = h & ((1 << shift) - 1);
		for (pnode it = l[hv]; it; it = it -> next)
			if (it->value == h)
				return true;
		return false;
	}
};

hash_table hashes;
hash_table final_hashes;
vector <int> g[nmax];

int tout[nmax];
int tin[nmax];
int TIME;
int H[nmax];
long long h[nmax];
long long poww[nmax];
int p[nmax];

char s[nmax];
bool used[nmax];
int n;


int request(int l, int r)
{
	r ++;
	if (tin[r] <= tin[l] && tout[l] <= tout[r])
		return H[l] - H[r];
	else
		return -1;
};

long long hash2(int l, int r)
{
	if (l == 0) return h[r];
	return h[r] - h[l - 1] * poww[r - l + 1];
}


bool final_have(long long hash2)
{
	return final_hashes.has(hash2);
//	return final_hashes.find(hash2) != final_hashes.end();
}

bool have(long long hash2)
{
	return hashes.has(hash2);
//	return hashes.find(hash2) != hashes.end();
}

void dfs(int v)
{
	tin[v] = TIME ++;
	used[v] = 1;
	for (int i = 0; i < g[v].size(); i ++)
	{
		int u = g[v][i];
		if (!used[u])
		{
			H[u] = H[v] + 1;
			dfs(u);
		}
	}
	tout[v] = TIME ++;
}

int valid_len[nmax];

int main()
{
	scanf("%d\n",&n);
	for (int i = 0; i < n; i ++)
	{
		scanf("%s\n", s);
		long long h = 0;
		for (int j = 0; s[j]; j ++)
		{
			h = h * base + s[j];
			hashes.insert(h);
		}
		final_hashes.insert(h);
		valid_len[i] = strlen(s);
	}
	sort(valid_len, valid_len + n);
	n = unique(valid_len, valid_len + n) - valid_len;
	scanf("%s\n",s);
	int slen = strlen(s);
	poww[0] = 1;
	h[0] = s[0];
	for (int i = 1; i < nmax; i ++)
		poww[i] = poww[i - 1] * base;
	for (int i = 1; i < slen; i ++)	
		h[i] = h[i - 1] * base + s[i];
	for (int i = 0; i < slen; i ++)
	{
		p[i] = -1;
		int l = - 1;
		int r = n;
		while (r - l > 1)
		{
			int m = (l + r) / 2;
			if (i + valid_len[m] <= slen && have(hash2(i,i + valid_len[m] - 1)))
				l = m;
			else
				r = m;
		}
		p[i] = i + valid_len[l];
		if (!final_have(hash2(i, p[i] - 1)))
			p[i] = -1;
	}
	for (int i = 0; i < slen; i ++)
		if (p[i] != -1)
		{
			g[p[i]].push_back(i);
		}
	for (int i = slen; i >= 0; i --)
		if (!used[i])
			dfs(i);
	int k;
	scanf("%d", &k);
	for (int i = 0; i < k; i ++)
	{
		int l,r;
		scanf("%d%d", &l, &r); l --; r --;
		printf("%d\n", request(l, r));
	}
	for (int i = 0; i < dmax; i ++)
		if (i < slen)
			compressed_div[i] = i;
		else
			compressed_div[i] = compressed_div[i - slen];  
	scanf("%d", &k);
	for (int i = 0; i < k; i ++)
	{
		long long res = 0;
		int t, a,b,c,d,m,l,r;
		scanf("%d %d %d %d %d %d %d %d", &t, &a,&b, &c, &d, &m, &l, &r); 
		int ans = 0;
		for (int j = 0; j < t; j ++)
		{
//			int tmpl = l % slen;
//			int tmpr = r % slen;
			int tmpl = compressed_div[l];
			int tmpr = compressed_div[r];
			if (tmpl > tmpr) swap(tmpl, tmpr);
			ans = request(tmpl, tmpr);		
			l = (a * l + b) % m;
			r = (c * r + d + ans) % m;
			if (ans != -1)
				res += ans;
		}
		int resv = res % m;
		printf("%d\n", resv);
	}
	return 0;
}
