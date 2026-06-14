// Minimal self-contained C++ sources for Codeforces/Polygon standard checkers.
// These implement the same exit-code protocol as testlib checkers:
//   argv[1]=input, argv[2]=contestant_output, argv[3]=jury_answer
//   exit 0 = OK, exit 1 = Wrong Answer, exit 2 = Presentation Error

const BASE = `
#include <cstdio>
#include <cstring>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <string>
#include <vector>
static void wa(const char* msg) { fprintf(stderr, "wrong answer: %s\\n", msg); exit(1); }
static void ok()                { fprintf(stderr, "ok\\n"); exit(0); }
static void pe(const char* msg) { fprintf(stderr, "wrong output format: %s\\n", msg); exit(2); }
`;

export const STD_CHECKERS: Record<string, string> = {
  // compare N integers (any whitespace-separated)
  'std::ncmp.cpp': BASE + `
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  long long u,v; int hasMore=0;
  while(fscanf(fa," %lld",&v)==1) {
    if(fscanf(fo," %lld",&u)!=1) wa("contestant output has fewer tokens");
    if(u!=v) wa("integers differ");
  }
  if(fscanf(fo," %lld",&u)==1) wa("contestant output has extra tokens");
  fclose(fo); fclose(fa); ok(); return 0;
}`,

  // compare N whitespace-separated words (case-sensitive)
  'std::wcmp.cpp': BASE + `
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  char u[1<<20],v[1<<20];
  while(fscanf(fa," %s",v)==1) {
    if(fscanf(fo," %s",u)!=1) wa("contestant output has fewer tokens");
    if(strcmp(u,v)) wa("words differ");
  }
  if(fscanf(fo," %s",u)==1) wa("contestant output has extra tokens");
  fclose(fo); fclose(fa); ok(); return 0;
}`,

  // single YES/NO (case-insensitive)
  'std::yesno.cpp': BASE + `
static void norm(char* s) { for(int i=0;s[i];i++) s[i]=tolower(s[i]); }
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  char u[64]="",v[64]="";
  fscanf(fa," %63s",v); fscanf(fo," %63s",u);
  norm(u); norm(v);
  if(strcmp(u,v)) wa("answer differs");
  fclose(fo); fclose(fa); ok(); return 0;
}`,

  // N YES/NO answers (case-insensitive)
  'std::nyesno.cpp': BASE + `
static void norm(char* s) { for(int i=0;s[i];i++) s[i]=tolower(s[i]); }
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  char u[64],v[64];
  while(fscanf(fa," %63s",v)==1) {
    if(fscanf(fo," %63s",u)!=1) wa("contestant output has fewer tokens");
    norm(u); norm(v);
    if(strcmp(u,v)) wa("yes/no answer differs");
  }
  if(fscanf(fo," %63s",u)==1) wa("contestant output has extra tokens");
  fclose(fo); fclose(fa); ok(); return 0;
}`,

  // compare line by line, tokenising each line (fcmp — flexible)
  'std::fcmp.cpp': BASE + `
static std::string readLine(FILE* f) {
  std::string s; int c;
  while((c=fgetc(f))!=EOF && c!='\\n') s+=(char)c;
  return s;
}
static std::vector<std::string> tokens(const std::string& line) {
  std::vector<std::string> v; std::string t;
  for(char c:line) { if(isspace((unsigned char)c)) { if(!t.empty()){v.push_back(t);t="";} } else t+=c; }
  if(!t.empty()) v.push_back(t); return v;
}
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  int lineNo=0; bool eofO=false,eofA=false;
  while(true) {
    std::string lo,la; bool gA,gO;
    // skip blank lines in answer
    do { if(feof(fa)){eofA=true;break;} la=readLine(fa); } while(tokens(la).empty());
    do { if(feof(fo)){eofO=true;break;} lo=readLine(fo); } while(tokens(lo).empty());
    if(eofA&&eofO) break;
    if(eofA!=eofO) wa(eofA?"contestant output has extra content":"contestant output is too short");
    auto ta=tokens(la), to=tokens(lo);
    if(ta!=to) wa("lines differ");
    lineNo++;
  }
  fclose(fo); fclose(fa); ok(); return 0;
}`,

  // compare line by line exactly (lcmp)
  'std::lcmp.cpp': BASE + `
static std::string readLine(FILE* f, bool& eof) {
  std::string s; int c;
  eof=false;
  if(feof(f)){eof=true;return s;}
  while((c=fgetc(f))!=EOF && c!='\\n') s+=(char)c;
  if(c==EOF) eof=true;
  return s;
}
static std::string trim(const std::string& s) {
  int l=0,r=(int)s.size()-1;
  while(l<=r&&isspace((unsigned char)s[l]))l++;
  while(r>=l&&isspace((unsigned char)s[r]))r--;
  return s.substr(l,r-l+1);
}
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  bool eofO,eofA;
  while(true) {
    std::string lo=readLine(fo,eofO), la=readLine(fa,eofA);
    if(eofO&&eofA) break;
    if(eofO!=eofA) wa(eofA?"contestant output has extra content":"contestant output is too short");
    if(trim(lo)!=trim(la)) wa("lines differ");
  }
  fclose(fo); fclose(fa); ok(); return 0;
}`,

  // single integer
  'std::icmp.cpp': BASE + `
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  long long u,v;
  if(fscanf(fa," %lld",&v)!=1) ok(); // empty answer
  if(fscanf(fo," %lld",&u)!=1) wa("no integer in output");
  if(u!=v) wa("integers differ");
  fclose(fo); fclose(fa); ok(); return 0;
}`,
};

// Generate rcmp with a given epsilon
function rcmpSrc(eps: number): string {
  return BASE + `
int main(int, char** a) {
  FILE* fo=fopen(a[2],"r"); FILE* fa=fopen(a[3],"r");
  double u,v;
  while(fscanf(fa," %lf",&v)==1) {
    if(fscanf(fo," %lf",&u)!=1) wa("contestant output has fewer numbers");
    double diff=fabs(u-v), scale=fmax(1.0,fabs(v));
    if(diff/scale>${eps} && diff>${eps}) wa("values differ beyond tolerance");
  }
  if(fscanf(fo," %lf",&u)==1) wa("contestant output has extra numbers");
  fclose(fo); fclose(fa); ok(); return 0;
}`;
}

STD_CHECKERS['std::rcmp.cpp']  = rcmpSrc(1e-6);
STD_CHECKERS['std::rcmp4.cpp'] = rcmpSrc(1e-4);
STD_CHECKERS['std::rcmp6.cpp'] = rcmpSrc(1e-6);
STD_CHECKERS['std::rcmp9.cpp'] = rcmpSrc(1e-9);
